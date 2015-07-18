/*!
 * SubEtha-Client
 * http://github.com/bemson/subetha-client/
 *
 * Copyright 2014, Bemi Faison
 * Released under the Apache License
 */
/* global define */
/* jshint scripturl:true */
!function (inAMD, inCJS, Array, Date, Object, scope, undefined) {

  function initSubEtha() {

    var
      // object to return when a value should not be captured
      hashIgnoreFlag = {},
      clientEventHandlers = {},
      defaultBridgeTimeout = 10000,
      noPromises = typeof Promise != 'function',
      Promee = noPromises ?
        function (cb) {
          // fake passing resolve and reject methods
          cb(noOp, noOp);
        } : Promise,
      // open request queue
      // request ticker
      ticker = 0,
      hasOwnProperty = Function.prototype.call.bind(Object.prototype.hasOwnProperty),
      arraySlice = Function.prototype.call.bind(Array.prototype.slice),
      doc = document,
      createElement = doc.createElement.bind(doc),
      docBody,
      domReady = 0,
      STATE_INITIAL = 0,
      STATE_QUEUED = 1,
      STATE_PENDING = 2,
      STATE_READY = 3,
      STATE_CLOSING = 4,
      JOIN_EVENT = '::join',
      DROP_EVENT = '::drop',
      CONNECT_EVENT = '::connect',
      DISCONNECT_EVENT = '::disconnect',
      CHANGE_EVENT = '::readyStateChange',
      unsupported = typeof MessageChannel != 'function',
      // tests whether a string looks like a domain
      /*
      should pass:
        a.co
        a.co/
        a.com
        a.com/
        a.b.co
        a.b.co/
        a.b.com
        a.b.com/
        a-b.co
        a-b.co/
        a-b.com
        a-b.com/

      in order to prefix with "//"
      */
      r_domainish = /^([\w\-]+\.)+[conmi]\w{1,2}\b/,
      inFileProtocol = location.protocol.charAt(0) == 'f',
      // for domainish urls, use http when in "file:" protocol
      urlPrefix = inFileProtocol ? 'http://' : '//',
      ethaDiv = createElement('div'),
      bridges = new Hash(),
      protocolVersion = 'se-1',
      serverList = {
        'public': (inFileProtocol ? 'http:' : '') + '//rawgit.com/bemson/subetha-bridge/master/public_bridge.html',
        'local': 'javascript:\'<scrip' + 't src="' + (inFileProtocol ? 'http:' : '') + '//rawgit.com/bemson/subetha-bridge/master/subetha-bridge.min.js"></script>\''
      },
      bind = scope.attachEvent ?
        function (object, eventName, callback) {
          object.attachEvent('on' + eventName, callback);
        } :
        function (object, eventName, callback) {
          object.addEventListener(eventName, callback, false);
        },
      unbind = scope.attachEvent ?
        function (object, eventName, callback) {
          object.detachEvent('on' + eventName, callback);
        } :
        function (object, eventName, callback) {
          object.removeEventListener(eventName, callback, false);
        },
      isArray = Array.isArray,

      /*
      handler signature
        1. bridge instance
        2. data
        3. message
      */
      messageHandlers = {

        // first message expected by bridge
        /*
        ready message
        {                     [message]
          mid: <int>,
          type: "ready",
          sent: <date>,
          received: <date>,
          data: <uri>         [data]
        }
        */
        ready: function (origin) {
          var bridge = this;

          // cancel abort timer
          bridge.delayAbort();

          // capture bridge origin... for logging?
          bridge.origin = origin;

          // note that bridge is ready
          bridge.state = STATE_READY;

          // if there are still queued agents
          if (bridge.queued.length) {
            // authorize currently queued agents
            bridge.authAgents();
          } else {
            // exit, since there are no agents to authorize (and use this bridge)
            bridge.destroy();
          }
        },

        // auth response from bridge
        /*
        // success payload

        {                              [payload]
          aid: <int>,                  // agent id
          id: <int>,                   // network id
          ok: 1,
          peers: {
            <int>: {                   // peer identifier
              id: <int>,
              channel: <channel-name>,
              origin: <uri>,
              start: <date>
            },
            ...
          }
        }

        // failure payload

        {
          aid: <int>                  // agent id
          ok: 0,
          status: <int>
        }

        */
        auth: function  (message, paylaod) {
          var
            bridge = this,
            pending = bridge.pending,
            agentIdx = message.idx,
            agent = pending.get(agentIdx),
            channels = bridge.channels,
            nids = bridge.nids,
            peerCfgs = message.peers,
            peers,
            clientId,
            peerId,
            client
          ;

          // avoid unknown/invalid/denied clients
          if (
            // unknown or non-pending agent
            !agent ||
            // denied authorication
            !message.ok
          ) {
            // if there is a corresponding agent...
            if (bridge.agents.has(agentIdx)) {
              // drop from bridge
              bridge.drop(agent);
            }
            // ignore message
            return;
          }

          // alias client
          client = agent.client;
          // capture id given by network
          clientId =
          client.id =
          agent.id =
            message.id;
          // add this agent to the network registry
          nids[clientId] = agent;
          // capture join date
          agent.joined = payload.sent;

          // remove agent from pending stack
          bridge.pending.del(agentIdx);

          // alias agent using the network id
          // the agentIdx is still .agents hash
          bridge.authed.set(clientId, agent);
          // add agent to (resolved) channel index
          channels.get(agent.channel, new Hash())
            .set(clientId, agent);

          // create new peers hash
          peers =
          agent.peers =
            new Hash();
          // create new client peers collection
          client.peers = {};

          // create unique peer instances for this client
          objectEach(peerCfgs, function (peerCfg) {
            // add peer to agent, silently
            agent.addPeer(peerCfg, 1);
          });

          // if client state change is not reversed..
          if (agent.change(STATE_READY)) {
            // fire join notification per peer
            for (peerId in peers) {
              if (hasOwnProperty(peers, peerId)) {
                // announce each connecting peer
                agent.announcePeer(peers[peerId], 1);
                // exit if the agent state changed
                // this means an event handler closed the connection
                if (agent.state != STATE_READY) {
                  break;
                }
              }
            }
          }

        },

        // notify clients of network changes
        /*
        // changes structure

        {
          joins: [
            {
              id: <guid>,
              channel: <channel-name>,
              origin: <url>,
              start: <date>
            },
            ...
          ],
          drops: [
            {
              channel: <channel-name>,
              ids: [ <guid>, ... ]
            },
            ...
          ]
        }

        */
        net: function (changes) {
          // create unique peers for clients in these channels
          // remove possible "bid" member - to not reveal bridge ids
          var
            bridge = this,
            joins = changes.joins,
            dropSets = changes.drops,
            dropSet,
            channel,
            peerCfg,
            ln
          ;


          // loop functions

          // add the peer to the agent
          function netAdder(agent) {
            if (bridge.state == STATE_READY && agent.state == STATE_READY) {
              agent.addPeer(peerCfg);
            }
          }

          // remove each peers from the agent
          function netRemover(agent) {
            var
              ids = dropSet.ids,
              idx = ids.length + 1
            ;

            if (bridge.state == STATE_READY && agent.state == STATE_READY) {
              // remove each peer from agent
              while (id = ids[--idx]) {
                agent.removePeer(id);
              }
            }
          }

          // process joins
          ln = joins.length + 1;
          while (peerCfg = joins[--ln]) {
            // exit if bridge is closed
            if (bridge.state != STATE_READY) {
              return;
            }

            // get clients in this channel
            channel = channels.get(peerCfg.channel);

            // skip if this bridge has no clients in this channel
            if (!channel) {
              continue;
            }

            // add and announce this peer to each client in this channel
            channel.each(netAdder);
          }

          // process drop sets
          ln = dropSets.length + 1;
          while (dropSet = dropSets[--ln]) {
            // exit if bridge is closed
            if (bridge.state != STATE_READY) {
              return;
            }

            // get clients in the dropset channel
            channel = channels.get(dropSet.channel);

            // skip if this bridge has no clients in this channel
            if (!channel) {
              continue;
            }

            // remove each peer id from the bridge registry
            bridge.deregNids(dropSet.ids);

            // drop and announce peers, leaving each client in this channel
            channel.each(netRemover);
          }

        },

        // handle killed bridge
        /*
        code structure

        <exit code>
        */
        die: function (code) {
          // remove bridge and disconnect clients
          this.destroy(code);
        },

        // handle client events
        /*
        data structure
        {                    [msg]
          type: <client-type>,
          from: <guid>,
          to: [<guid>, ...],
          data: <mixed>  [data] *optional
        }
        */
        client: function (message, payload) {
          var
            bridge = this,
            fromId = message.from,
            msgData = message.data,
            recipients = message.to,
            handlerName = message.type,
            handler,
            client,
            idx = -1,
            msgInfo,
            clientPeers,
            fromPeer
          ;
          // early exit when...
          if (
            // no handlers for this message type
            !hasOwnProperty(clientEventHandlers, handlerName) ||
            // unknown sender (not in bridge registry)
            !hasOwnProperty(bridge.nids, fromId) ||
            // get event handler
            typeof (handler = clientEventHandlers[handlerName]) != 'function'
          ) {
            // log error(s)?
            return;
          }

          // get copy of sender - an object literal
          sender = mix({}, nids[fromId]);
          // use channel as pool of recipients
          channel = bridge.channels.get(sender.channel);

          // exit when this bridge has no agents from this channel
          if (!channel) {
            // log error?
            return;
          }

          // when broadcasting to all clients...
          if (!recipients) {
            // target all clients in the channel
            recipients = channel.keys;
          }

          // create meta message object, for event handlers
          msgInfo = {
            mid: payload.mid,             // message id
            sent: payload.sent,           // sent date
            received: payload.received,   // recieve date
            broadcast: !message.to,       // flag when this is a broadcast
            recipients: recipients.length // number of recipients
          };

          // invoke handler on all targeted clients
          while (agent = recipients[++idx]) {
            // exit if bridge is down
            if (bridge.state != STATE_READY) {
              return;
            }
            // alias client
            client = agent.client;
            // skip if client/peer state is invalid
            if (
              agent.state != STATE_READY ||
              // peers has been abused
              typeof (clientPeers = client.peers) != 'object' ||
              // sender is not a Peer or in client's peers collection
              !((fromPeer = clientPeers[fromId]) instanceof Peer) // ||
              /*
              TODO: enable client-peer blocklist
              // client is ignoring this sender
              hasOwnProperty(agent.ignored, fromId) //
              */
            ) {
              continue;
            }

            // invoke custom handler
            handler(
              // "to" client
              client,
              // "from" peer
              fromPeer,
              // custom event data
              msgData,
              // message meta
              msgInfo
            );
          }
        },

        // handle sent message response
        /*
        data structure
        {
          rid: <int>,
          ok: <bool>,
          status: <code>
        }
        */
        sent: function (response) {
          var
            bridge = this,
            request = bridge.requests.del(response.rid),
            status = response.status
          ;
          // if the request exists...
          if (request) {
            agent = request.agent;
            // if agent is still active...
            if (agent.state == STATE_READY) {
              // fulfill promise
              if (response.ok) {
                request.yes(status);
              } else {
                request.no(status);
              }
            }
          }
        }

      },

      // public API
      subetha = {

        // number of milliseconds to wait for the bridge to connect
        bridgeTimeout: defaultBridgeTimeout,

        Client: Client,

        Peer: Peer,

        EventEmitter: EventEmitter,

        protocol: protocolVersion,

        servers: serverList,

        // collection of client types this client can process
        /*
        handler signature
          1. receiving client instance
          2. sending peer instance
          3. data
          4. msg (in payload)
          5. payload (message meta)

        data structure
        {                           [payload]
          mid: <int>,
          type: "client",
          sent: <date>,
          data: {                    [msg]
            rid: <int>,
            type: "event",
            from: <int>,
            to: [<int>, ...],
            data: <event-data>      [data] *optional
          }
        }
        */
        types: clientEventHandlers

      }
    ;

    // build ethadiv
    ethaDiv.style.display = 'none';
    ethaDiv.setAttribute('aria-hidden', 'true');
    ethaDiv.setAttribute('hidden', 'hidden');
    ethaDiv.setAttribute('data-owner', 'subetha');

    // extend fake Promise, in order to... fake Promises
    if (noPromises) {
      Promee.prototype.then =
      Promee.prototype['catch'] =
        function () {
          return this;
        };
    }

    // UTILITY

    // shared empty fnc
    function noOp() {}

    // shallow object merge
    function mix(base) {
      var
        argIdx = -1,
        source,
        member
      ;

      for (; source = arguments[++argIdx];) {
        for (member in source) {
          if (hasOwnProperty(source, member)) {
            base[member] = source[member];
          }
        }
      }
      return base;
    }

    // loop over an object's keys
    function objectEach(obj, fn) {
      var key;

      for (key in obj) {
        if (hasOwnProperty(obj, key)) {
          fn(obj[key], key);
        }
      }
    }

    function isFullString(value) {
      return value && typeof value === 'string';
    }

    // FUNCTIONS

    // return auth request object invoked per queued agent
    function makeAgentReqAuthCfg(agent, agentIdx) {
      var
        client = agent.client,
        creds = 0
      ;

      // exit if app denies authorizing this client
      if (!agent.change(STATE_PENDING)) {
        // send flag so that the returned value is not captured
        return hashIgnoreFlag;
      }

      // ensure credentials is an array
      if (hasOwnProperty(client, 'credentials')) {
        creds = client.credentials;
        if (!isArray(creds)) {
          creds = [creds];
        }
      }

      // move agent to the pending list
      agent.bridge.pending.set(agentIdx, agent);

      // add an agent authorization request
      return {
        aid: agentIdx,              // agent id
        channel: client.channel,    // channel
        creds: creds                // credentials
      };
    }

    function getActiveClientIndex(client) {
      return activeClients.indexOf(client);
    }

    // remove expired slots in the active clients array
    function pruneActiveClients() {
      var idx = activeClients.length;

      // exit when there are no active clients
      if (!idx) {
        return;
      }

      // decrement until we find a non non-empty index
      do {
        --idx;
      } while (~idx && !activeClients[idx]);
      // reset length to prune empty indice
      activeClients.length = idx + 1;
    }

    // get corresponding agent in bridge for this client
    function getAgent(client) {
      var
        agent,
        activeIdx
      ;

      // if there is an "_idx" property
      if (hasOwnProperty(client, '_idx')) {
        // retrieve the agent at the (untrusted) client index
        agent = agents.get(client._idx);
        // return the (validated) corresponding agent
        if (agent && agent.client === client) {
          return agent;
        }
      }

      // otherwise, attempt array-reference lookup

      // search for this client
      activeIdx = getActiveClientIndex(client);
      // when there is an active client
      if (~activeIdx) {
        // get corresponding agent at the same index
        agent = agents.get(activeIdx);
        // if there is an agent...
        if (agent) {
          // capture the client index - for faster lookup next time
          client._idx = activeIdx;
          return agent;
        } else {
          // remove (orphaned?) active client
          // we should never hit this line of code
          activeClients[activeIdx] = 0;
        }
      }
    }

    // route the array of subetha-messages from the port message event
    /*
    handle payload, sent via the incoming MessagePort
    payload is one or an array of message objects
    message structure
    {                     [message]
      mid: <int>,
      type: <string>,
      sent: <date>,
      received: <date>,   // added by host
      data: <mixed>       [data]
    }
    */
    function bridgePortRouter(evt) {
      var
        bridge = this,
        payload = evt.data,
        received = Date.now(),
        msgIdx = -1,
        msg,
        msgType
      ;

      // process multiple messages
      while (msg = payload[++msgIdx]) {
        // capture message type
        msgType = msg.type;
        // add "received" member
        msg.received = received;

        // if there is a handler for this message type
        if (hasOwnProperty(messageHandlers, msgType)) {
          // invoke handler, scoped to bridge, with data and full message
          messageHandlers[msgType].call(bridge, msg.data, msg);
        } /* else log/fire/throw error? */

        // stop processing messages, if the bridge is no longer ready
        if (bridge.state != STATE_READY) {
          break;
        }
      }
    }

    function removeEthaDiv() {
      if (docBody && docBody.contains(ethaDiv)) {
        // remove ethaDiv from DOM
        docBody.removeChild(ethaDiv);
      }
    }

    // complete subetha initialization
    function onDomReady() {

      // set domReady flag
      domReady = 1;

      // alias body
      docBody = doc.body;

      // remove DOM listeners
      unbind(scope, 'DOMContentLoaded', onDomReady);
      unbind(scope, 'load', onDomReady);

      // open all bridges
      bridges.each(function (bridge) {
        bridge.open();
      });
    }

    // CLASSES

    function Hash(val) {
      var
        hash = this,
        items = {},
        keys = [],
        key,
        length = 0
      ;

      // init memoization space
      hash._mf = {};

      // if given an initial value
      if (typeof val == 'object') {
        for (key in val) {
          if (hasOwnProperty(val, key)) {
            // copy key and value
            items[key] = val[key];
            // capture key
            key.push(key);
            // increment length
            ++length;
          }
        }
      }

      // set as items
      hash.items = items;
      hash.length = length;
      hash.keys = keys;
    }

    mix(Hash.prototype, {
      _mv: 0,
      set: function (key, value) {
        var hash = this;

        if (!hash.has(key)) {
          ++hash.length;
          hash.keys.push(key);
        }
        hash.items[key] = value;

        return value;
      },
      del: function (key) {
        var
          hash = this,
          removedValue = hash.get(key),
          keys = hash.keys
        ;

        if (removedValue) {
          delete hash.items[key];
          --hash.length;
          keys.splice(keys.indexOf(key), 1);
          return removedValue;
        }
      },
      has: function (key) {
        return hasOwnProperty(this.items, key);
      },
      get: function (key, defaultValue) {
        var hash = this;

        if (hash.has(key)) {
          return hash.items[key];
        } else if (defaultValue) {
          // set first value with key
          return hash.set(key, defaultValue);
        }
      },
      clear: function () {
        var hash = this;

        hash.items = {};
        hash.length = 0;
      },
      each: function (fn) {
        var
          hash = this,
          items = hash.items,
          val,
          returnedValues = [],
          key
        ;
        for (key in items) {
          if (hasOwnProperty(items, key)) {
            val = fn(items[key], key);
            if (val !== hashIgnoreFlag) {
              returnedValues.push(fn(items[key], key));
            }
          }
        }
        return returnedValues;
      },
      copy: function () {
        return new Hash(this.items);
      }
    });

    // mechanism for handling async promises
    function Request(agent) {
      var request = this;

      // create request id
      request.id = ++ticker;
      // reference agent
      request.agent = agent;

      // make promise
      request.promise = new Promee(function (resolve, reject) {
        // expose Promise resolution functions
        request.resolve = resolve;
        request.reject = reject;
      });

    }

    mix(Request.prototype, {

      // resolve promise
      yes: function (status) {
        var request = this;

        request.done();

        // approve promise with args
        request.resolve(status);
      },

      // reject promise
      no: function (status) {
        var request = this;

        request.done();

        // reject promise with status
        request.reject(new Error(status));
      },

      // place request up for responses
      log: function () {
        var request = this;

        // add to bridge requests
        request.agent.bridge.requests.set(request.id, request);
      },

      // remove request from responses
      done: function () {
        var
          request = this,
          agent = request.agent
        ;

        // remove from bridge requests

        // testing for agent, since a code path allows invoking
        // this method without a valid `.agent`
        if (agent) {
          agent.bridge.requests.del(request.id);
        }
      }

    });

    function Bridge(network) {
      var bridge = this;

      bridge.iframe = iframe;
      bridge.id = network;

      // create hashes
      bridge.agents = new Hash();
      bridge.queued = new Hash();
      bridge.pending = new Hash();
      bridge.authed = new Hash();
      bridge.channels = new Hash();
      bridge.requests = new Hash();
      // simple collection of all network ids
      bridge.nids = {};

    }

    mix(Bridge.prototype, {

      // bridges start queued, since they are immediately added to the dom
      state: STATE_INITIAL,

      // number of clients
      cnt: 0,

      // timer for authenticating agents
      authTimer: 0,

      // add and watch iframe
      open: function () {
        var
          bridge = this,
          iframe,
          timeout = subetha.bridgeTimeout
        ;

        // exit when already opening/opened or dom is not ready
        if (bridge.state > STATE_INITIAL) {
          return;
        }

        // set bridge state to queued
        bridge.state = STATE_QUEUED;

        // create iframe
        iframe =
        bridge.iframe =
          createElement('iframe');

        // define method for binding to this iframe's !onload event
        bridge.onLoad = bridge.rig.bind(bridge);
        // bind pre-bound method for whenever this iframe fire's it's load event
        bind(iframe, 'load', bridge.onLoad);

        // define bound global router for this bridge, for use in link()
        bridge.onMessage = bridgePortRouter.bind(bridge);

        if (hasOwnProperty(serverList, network)) {
          // use aliased network aliased
          iframe.src = serverList[network];
        } else {
          // use raw network
          iframe.src = network;
        }

        // give bridge time to connect
        bridge.delayAbort(isNaN(timeout) ? defaultBridgeTimeout : parseInt(timeout, 10));

        // add bridge to ethadiv
        ethaDiv.appendChild(iframe);

        // ensure iframe is in the dom
        if (!bridge.inDom()) {
          docBody.appendChild(ethaDiv);
        }

      },

      // remove peers from registry
      // this should only be called via the "net" event handler
      deregNids: function (peers) {
        var
          nids = this.nids,
          ln = nids.length + 1
        ;
        while (ln--) {
          delete nids[peers[ln]];
        }
      },

      // send MessageChannel port to iframe
      rig: function () {
        var
          bridge = this,
          mc
        ;

        // exit to prohibit a bridge from
        // reloading after establishing a connection
        if (bridge.state > STATE_PENDING) {
          bridge.destroy();
          return;
        }

        // close any existing message channel
        bridge.unrig();

        // (re)set state to pending
        bridge.state = STATE_PENDING;

        try {
          // create new message channel
          mc = new MessageChannel();

          // track message channel port
          bridge.port = mc.port1;

          // listen to the incoming port
          // route "message" events with pre-bound bridge method
          mc.port1.onmessage = bridge.onMessage;

          // send outgoing port to the iframe
          bridge.iframe.contentWindow.postMessage(
            // bootstrap payload
            {
              protocol: protocolVersion,
              network: bridge.id
            },
            '*',
            // transfer port
            [mc.port2]
          );
        } catch (e) {
          // error, log?
          bridge.destroy();
        }
      },

      // close any existing message channel
      unrig: function () {
        var
          bridge = this,
          port = bridge.port
        ;
        // if there is a message channel...
        if (port) {
          // close the port
          port.close();

          // dereference the port (listener) and message channel
          port.onmessage =
          bridge.port =
            0;
        }
      },

      // add agent to the bridge (queue)
      join: function (agent) {
        var
          bridge = this,
          agentIdx = agent.idx
        ;

        // exit if agent gets closed after event callbacks
        if (!agent.change(STATE_QUEUED)) {
          return;
        }

        // add agent to queued list
        bridge.queued.set(agentIdx, agent);
        // add agent to master list
        bridge.agents.set(agentIdx, agent);

        if (bridge.state == STATE_READY) {
          // schedule agent authenticating for later
          bridge.delayAuths(1);
        }
      },

      // remove agent from bridge
      drop: function (agent) {
        var
          bridge = this,
          agentState = agent.state,
          agentIdx = agent.idx,
          agents = bridge.agents,
          clientId = agent.id,
          channels = bridge.channels,
          channelName = agent.channel,
          channel,
          hash
        ;

        // resolve and remove agent from temporary hash
        if (agentState == STATE_QUEUED) {
          hash = bridge.queued;
        } else if (agentState == STATE_PENDING) {
          hash = bridge.pending;
        }
        if (hash) {
          hash.del(agentIdx);
        }
        // (always) remove from master list
        agents.del(agentIdx);

        // if there is a network id...
        if (clientId) {
          // remove network id
          bridge.authed.del(clientId);
          // remove client from network registry
          delete bridge.nids[clientId];

          // get channel
          channel = channels.get(channelName);
          // if there is a channel for this agent...
          if (channel) {
            // remove agent from channel
            channel.del(clientId);
            // if there are no more agents in this channel...
            if (!channel.length) {
              // remove channel
              channels.del(channelName);
            }
          }
        }

        // deactivate corresponding client
        activeClients[agentIdx] = 0;
        // if we deactivated the last client...
        if (activeClients.length == agentIdx) {
          // prune other deactivated client indice
          pruneActiveClients();
        }

        // notify client of state change
        agent.change(STATE_CLOSING);

        // if there are no more agents...
        if (!agents.length) {
          // destroy bridge (since there are no more agents)
          // other hosts will inform that this client disconected
          // this saves having to send two messages to the bridge
          bridge.destroy();
        } else if (agentState > STATE_QUEUED) {

          // otherwise, if the agent is/was on the network

          // tell network to drop this agent
          bridge.send('drop', clientId);
        }

      },

      // clear (and reset) delay to authorize agents
      delayAuths: function (schedule) {
        var bridge = this;

        // stop any existing delay
        clearTimeout(bridge.authTimer);

        if (schedule) {
          // auth this and other agents after a delay
          bridge.authTimer = setTimeout(bridge.authAgents.bind(bridge), 50);
        }
      },

      // authorize queued agents with bridge
      // moves agents from queued to pending status
      authAgents: function () {
        var
          bridge = this,
          queued = bridge.queued,
          queuedCopy,
          // collection of agent authorization requests
          agentAuthRequests = []
        ;

        // exit if bridge is not ready or there are no queued agents
        if (bridge.state != STATE_READY || !queued.length) {
          return;
        }

        // stop any potential auth delay
        bridge.delayAuths();

        // copy queued agents
        queuedCopy = queued.copy();

        // clear queued agents
        queued.clear();

        // get agent authorization requests
        agentAuthRequests = queuedCopy.each(makeAgentReqAuthCfg);

        // if there are any agents to authorize
        if (agentAuthRequests.length) {
          // request to authorize these agents
          bridge.send('auth', agentAuthRequests);
        }
      },

      destroy: function () {
        var
          bridge = this,
          iframe = bridge.iframe
        ;

        // prevent clients from transmitting
        bridge.state = STATE_CLOSING;

        // cancel destruction timer
        bridge.delayAbort();
        // cancel authorization timer
        bridge.delayAuths();

        // delist this bridge
        bridges.del(bridge.id);

        // if an iframe was created...
        if (iframe) {

          // kill load listener for this bridge
          unbind(iframe, 'load', bridge.onLoad);

          // close any MessageChannel port
          bridge.unrig();
        }

        // if this is the last bridge...
        if (!bridges.length) {
          // remove the ethaDiv
          removeEthaDiv();
        }

        if (iframe && ethaDiv.contains(iframe)) {
          // remove this bridge's iframe from ethadiv
          ethaDiv.removeChild(iframe);
        }

        // drop all queued, pending, and authed agents
        bridge.agents.each(function (agent) {
          bridge.drop(agent);
        });
      },

      // specifies when bridge iframe is in the page ethadiv and dom
      inDom: function () {
        var iframe = this.iframe;

        return ethaDiv.contains(iframe) && docBody.contains(iframe);
      },

      // (dooms-day) wait before destroying bridge
      // stops timer when called without params
      delayAbort: function (ms) {
        var bridge = this;

        // stop current timebomb
        clearTimeout(bridge.abortTimer);

        // start new countdown
        if (ms) {
          bridge.abortTimer = setTimeout(function () {
            bridge.destroy(/* TODO: code for abort timer expired */);
          }, ms);
        }
      },

      // send protocol message to bridge
      send: function (type, data) {
        var
          bridge = this,
          msgId = ++ticker
        ;

        // only send when ready
        if (bridge.state != STATE_READY) {
          return 0;
        }

        try {
          bridge.port.postMessage(
            // protocol message
            {
              // message identifier
              mid: msgId,
              // type of message
              type: type,
              // message content
              data: data
            }
          );
        } catch (e) {
          // log error?
          return 0;
        }

        // return message id
        return msgId;
      }

    });

    // internal state corresponding to client and bridge connection
    function Agent(idx, client, bridge) {
      var agent = this;

      agent.idx = idx;
      agent.client = client;
      agent.bridge = bridge;
      agent.peers = client.peers;
      // preserve channel (given to the bridge, that is)
      // protects untrusted changes to client channel
      agent.channel = client.channel;
    }

    mix(Agent.prototype, {

      state: STATE_INITIAL,

      // change agent (and sync client) state)
      // return true when state change is not intercepted
      change: function (newState) {
        var
          agent = this,
          oldState = agent.state,
          client = agent.client
        ;

        // exit when not changing the state
        if (newState == oldState) {
          return 1;
        }

        // set state on client
        client.state = newState;
        // announce client state change
        client.fire(CHANGE_EVENT, newState, oldState);

        // fail if the agent state changed after firing this event
        if (agent.state != newState) {
          return 0;
        }

        // fire special events based on transition

        // if closing the agent...
        if (newState == STATE_CLOSING) {
          // clear client peers
          client.peers = {};
          // if was connected...
          if (oldState == STATE_READY) {
            // fire disconnect event, pass the previous server and connection time
            client.fire(DISCONNECT_EVENT, agent.channel + '@' + agent.bridge.id, agent.sent);
          }
        } else if (newState == STATE_READY) {

          // otherwise, if connecting the agent...

          // fire ready event
          client.fire(CONNECT_EVENT);
          // if no longer ready...
          if (agent.state != newState) {
            // fail state transition
            return 0;
          }
        }

        // note that state transiton succeeded
        return 1;
      },

      // add peer instance - triggered via network event
      addPeer: function (peerData, silent) {
        var
          agent = this,
          client = agent.client,
          peer = new Peer(peerData, client),
          peerId = peer.id
        ;

        // add peer to bridge registry
        agent.bridge.nids[peerId] = peerData;
        // add peer instance to agent and client
        client.peers[peerId] = agent.peers.set(peerId, peer);
        if (!silent) {
          // notify client of peer addition
          client.announcePeer(peer);
        }
      },

      // fire the join event per peer
      announcePeer: function (peer, initial) {
        var
          agent = this,
          client = agent.client
        ;
        // fire join event to announce when a peer has been added
        // the initial flag indicates if the peer was part of the initial peers
        client.fire(JOIN_EVENT, peer, !!initial);
      },

      // remove peer instance - triggered via network event
      removePeer: function (peerId) {
        var
          agent = this,
          client = agent.client,
          clientPeers = client.peers,
          // capture dropped peer
          peer = agent.peers.del(peerId)
        ;

        // if a peer was dropped and the client recognizes it...
        if (peer && hasOwnProperty(clientPeers, peerId)) {
          // set peer state (for completeness)
          peer.state = STATE_INITIAL;
          // remove from client peers collection
          delete clientPeers[peerId];
          // notify client of disconnected peer
          client.fire(DROP_EVENT, peer);
        }
      },

      // kill this connection
      kill: function () {
        var agent = this;

        // tell bridge to remove this agent
        agent.bridge.drop(agent);

      },

      vetPeers: function (candidates) {
        var
          agent = this,
          peers = agent.peers,
          clientPeers = agent.client.peers,
          resolved = [],
          ln,
          ref
        ;

        // exit if client peers is invalid
        // this would happen if the user abused/removed their "peers" member
        if (clientPeers && typeof clientPeers != 'object') {
          return 0;
        }

        if (!isArray(candidates)) {
          candidates = [candidates];
        }
        ln = candidates.length;

        // loop over peer candidates
        while (ln--) {
          ref = candidates[ln];
          // get peer id
          if (ref instanceof Peer) {
            ref = ref.id;
          }
          // fail if this id is not a peer of this agent or client
          if (hasOwnProperty(clientPeers, ref) && peers.has(ref)) {
            return 0;
          }
          // (otherwise) capture this id
          resolved.push(ref);
        }
        // return allowed peer ids
        return resolved;
      }

    });

    // basic event emitter
    function EventEmitter() {}

    mix(EventEmitter.prototype, {
      on: function (evt, callback) {
        var me = this;

        if (
          isFullString(evt) &&
          typeof callback === 'function'
        ) {
          if (!hasOwnProperty(me, '_evts')) {
            // init events hash
            me._evts = {};
          }
          if (!hasOwnProperty(me._evts, evt)) {
            // init event queue
            me._evts[evt] = [];
          }
          // add callback to event queue
          me._evts[evt].push(callback);
        }
        return me;
      },
      off: function (evt, callback) {
        var
          me = this,
          cbs,
          cbLn,
          argLn = arguments.length;

        if (!hasOwnProperty(me, '_evts') || !argLn) {
          // reset if clearing all events
          me._evts = {};
        } else if (
          isFullString(evt) &&
          hasOwnProperty(me._evts, evt)
        ) {
          cbs = me._evts[evt];
          if (typeof callback == 'function') {
            cbLn = cbs.length;
            // remove the last matching callback only
            while (cbLn--) {
              if (cbs[cbLn] === callback) {
                cbs.splice(cbLn, 1);
                break;
              }
            }
          }
          // remove event queue if no callback or none left
          if (argLn < 2 || !cbs.length) {
            delete me._evts[evt];
          }
        }

        return me;
      },
      fire: function (evtName) {
        var
          me = this,
          params,
          cbs,
          cbLn,
          cbIdx = -1,
          callbackInvoker
        ;
        if (
          isFullString(evt) &&
          hasOwnProperty(me, '_evts') &&
          hasOwnProperty(me._evts, evtName) &&
          (cbs = me._evts[evtName]).length
        ) {
          params = arraySlice(arguments, 1);
          if (params.length) {
            callbackInvoker = function (cb) {
              cb.apply(me, params);
            };
          } else {
            callbackInvoker = function (cb) {
              cb.call(me);
            };
          }
          for (;cb = cbs[++cbIdx];) {
            callbackInvoker(cbs[cbIdx]);
          }
        }

        return me;
      }
    });

    function Client () {
      var me = this;

      // hash of peers
      me.peers = {};
      // init credentials array
      me.credentials = [];
    }

    // extend EventEmitter
    Client.prototype = new EventEmitter();

    mix(Client.prototype, {

      // the id of the client
      id: 0,

      // default channel
      channel: 'lobby',

      // default server-url
      server: 'local',

      // connection state
      state: STATE_INITIAL,

      // add client to bridge queue
      open: function (network) {
        var
          client = this,
          args = arguments,
          // retrieve existing agent (if any)
          agent = getAgent(client),
          bridge,
          channel,
          url,
          pos
        ;

        // process the given channel...
        if (isFullString(network)) {
          pos = network.indexOf('@');
          // if the network address appears to have two parts...
          if (~pos) {
            // get channel portion
            channel = network.substring(0, pos);
            // use remainder as the (bridge) url
            url = network.substring(pos + 1);

            // capture resolved channel
            client.channel = channel;

            // if the given url is truthy
            if (url) {
              // prepend protocol safe prefix, if it looks like a full url
              if (r_domainish.test(url)) {
                url = urlPrefix + url;
              }
              // capture resolve bridge url
              client.server = url;
            }

          } else {
            // (otherwise) treat network address as the channel only
            client.channel = network;
          }

          // set access credentials when given new/existing network
          client.credentials = args.length ? arraySlice(args, 1) : [];

        }

        // if there is agent already (i.e., the client is already active)...
        if (agent) {

          // close existing connection
          agent.kill();

          // if there is yet another agent...
          if (getAgent(client)) {
            // exit, since this means an event handler opened this client first
            // during "disconnect" or "readyStateChange" events
            return client;
          }

        }

        // alias bridge url
        url = client.server;

        // resolve bridge with this url

        if (bridges.has(url)) {
          // get existing bridge
          bridge = bridges.get(url);
        } else {
          // create new bridge
          bridge = bridges.set(url, new Bridge(url));

          // open bridge if dom is ready
          if (domReady) {
            bridge.open();
          }
        }

        // activate this client and create bridge

        // capture index of client added to the active client list
        agentIdx = activeClients.push(client) - 1;
        // capture for simpler lookup
        client._idx = agentIdx;
        // reset peers
        client.peers = {};

        // create agent to link the bridge and client
        agent = new Agent(agentIdx, client, bridge);

        // add agent to this bridge
        bridge.join(agent);

        // stay monadic
        return client;
      },

      // close or abort connection
      close: function () {
        var
          client = this,
          agent = getAgent(client)
        ;

        if (agent) {
          agent.kill();
        }

        return client;
      },

      // send arbitrary client message
      _transmit: function (type, data, peers) {
        var
          client = this,
          agent = getAgent(client),
          request = new Request(agent),
          bridge
        ;

        if (agent) {
          bridge = agent.bridge;
        }

        // only use bridge when...
        if (

          // bridge and client/agent are connected
          bridge &&
          bridge.state == STATE_READY &&
          agent.state == STATE_READY &&

          // type is valid
          isFullString(type) &&
          // type has a handler
          hasOwnProperty(clientEventHandlers, type)

          // recipients are...
          (
            // everyone, or...
            !peers ||
            // targets are valid...
            (peers = agent.vetPeers(peers))
          )

        ) {

          // if bridge successfully sends this message...
          if (
            bridge.send(
              'client',
              {
                type: type,
                rid: request.id,
                from: agent.id,
                to: peers || 0,
                data: data
              }
            )
          ) {
            // activate request for resolution later
            request.log();
          } else {
            // reject request since send failed
            request.no('failed');
          }

        } else {
          // reject promise now
          // TODO: provide more exit points and error messages
          request.no('invalid message, state, or peers');
        }

        // return promise
        return request.promise;
      }

    });

    // proxy for communicating with a specific peer
    function Peer(peerData, client) {
      var me = this;

      // link to client
      me._client = client;
      if (peerData) {
        me.id = peerData.id;
        me.origin = peerData.origin;
        me.start = peerData.start;
        me.channel = peerData.channel;
      }
    }

    mix(Peer.prototype, {

      // indicates peer is usable
      state: STATE_READY//,

      // manage block list
      // block: function () {
      //   var
      //     peer = this,
      //     agent;

      //   // exit if peer is dead or non-active
      //   if (
      //     peer.state != STATE_READY ||
      //     !(agent = getAgent(peer._client))
      //   ) {
      //     return;
      //   }
      //   agent.blocked[peer.id]
      // }

    });


    // if there is no postMessage method
    if (unsupported) {

      // deny all clients
      Client.prototype.open = function () {
        return this;
      };

    } else if (doc.body) {
      // perform dom ready stuff now
      onDomReady();
    } else {
      // wait for dom ready
      bind(scope, 'DOMContentLoaded', onDomReady);
      bind(scope, 'load', onDomReady);
    }

    return subetha;
  }

  // initialize and expose module, based on the environment
  if (inAMD) {
    define(initSubEtha);
  } else if (inCJS) {
    module.exports = initSubEtha();
  } else if (!scope.Subetha) {
    scope.Subetha = initSubEtha();
  }
}(
  typeof define === 'function',
  typeof exports != 'undefined',
  Array, Date, Object, this
);
/*!
 * SubEtha-Client
 * http://github.com/bemson/subetha-client/
 *
 * Copyright 2014, Bemi Faison
 * Released under the Apache License
 */
/* global define, require */
!function (inAMD, inCJS, Array, Date, Math, JSON, Object, RegExp, scope, undefined) {

  function initSubEtha() {

    var
      Morus = ((inCJS || inAMD) ? require('morus') : scope.Morus),
      JSONstringify = JSON.stringify,
      JSONparse = JSON.parse,
      mathRandom = Math.random,
      protoHas = Object.prototype.hasOwnProperty,
      protoSlice = Array.prototype.slice,
      doc = document,
      docBody,
      domReady = 0,
      rxp_guid = /[xy]/g,
      guidPattern = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx',
      speakerKey = mathRandom(),
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
      netEvts = {},
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
      // extracts json with decoded data
      r_extractJSON = /^[^{]{0,40}({.+})[^}]{0,40}$/,
      inFileProtocol = location.protocol.charAt(0) == 'f',
      // for domainish urls, use http when in "file:" protocol
      urlPrefix = inFileProtocol ? 'http://' : '//',
      ethaDiv = doc.createElement('div'),
      bridges = {},
      bridgeCnt = 0,
      // clients queued to open (before DOMReady)
      clientQueue = {},
      protocolVersion = 'se-0',
      privateKey = {},
      // add to global queue (before DOMReady)
      addClient = function (client) {
        clientQueue[client.id] = client;
      },
      // remove from global queue (before DOMReady)
      removeClient = function (client) {
        delete clientQueue[client.id];
        setClientState(client, STATE_INITIAL);
      },
      canPostObjects = /trident/i.test(navigator.userAgent) ? 0 : !!function () {
        var yes = 1;

        // synchronous check for postMessage object support!
        // thx gregers@http://stackoverflow.com/a/20743286
        try {
          scope.postMessage({
            toString: function () {
              yes = 0;
            }
          }, '*');
        } catch (e) {}

        return yes;
      }(),
      postMessage = canPostObjects ?
        function (win, msg) {
          win.postMessage(msg, '*');
        } :
        function (win, msg) {
          win.postMessage(JSONstringify(msg), '*');
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
      isArray = typeof Array.isArray === 'function' ?
        Array.isArray :
        function (obj) {
          return obj instanceof Array;
        },

      /*
      handler signature
        1. bridge instance
        2. msg (in payload)
        3. payload (decoded from event)
        4. native post-message event
      */
      bridgeDataHandlers = {

        // first message expected by bridge
        /*
        payload structure
        {                  [payload]
          mid: <guid>,
          type: "ready",
          sent: <date>,
          msg: <uri>            [msg]
        }
        */
        ready: function (bridge, origin) {
          var
            clients = bridge.clients,
            clientId;

          // cancel timer
          bridge.dDay();

          // capture bridge origin, for logging?
          bridge.origin = origin;

          // note that bridge is ready
          bridge.state = STATE_READY;

          // authorize queued clients
          for (clientId in clients) {
            if (protoHas.call(clients, clientId)) {
              bridge.auth(clients[clientId]);
            }
          }
        },

        // auth response from bridge
        /*
        payload structure
        {                 [payload]
          mid: <guid>,
          type: "auth",
          sent: <date>,
          msg: {          [msg]
            id: <guid>,
            ok: booly,
            peers: {
              <guid>: {
                id: <guid>,
                channel: <channel-name>,
                origin: <uri>
              },
              ...
            },       // optional for failures
            reason: <string> // optional for faliures
          }
        }
        */
        auth: function  (bridge, msg) {
          var
            channels = bridge.channels,
            clients = bridge.clients,
            clientId = msg.id,
            hasPeers,
            client,
            clientPeers,
            networkPeers,
            peerId,
            channelName;

          if (!protoHas.call(clients, clientId)) {
            // avoid unknown clients
            return;
          }

          // target client
          client = clients[clientId];
          // get peers
          networkPeers = msg.peers;

          // determine whether to keep or reject client
          if (
            // rejected
            !msg.ok ||
            // unwarranted authorization (wrong state client)
            client.state !== STATE_PENDING
          ) {
            // boot client
            bridge.remove(client);
            return;
          }

          // clear peers
          clientPeers = client.peers = {};
          // add pre-existing peers
          for (peerId in networkPeers) {
            if (protoHas.call(networkPeers, peerId)) {
              hasPeers = 1;
              addPeerToClient(client, networkPeers[peerId]);
            }
          }

          // add to channel index
          channelName = client.channel;
          if (!protoHas.call(channels, channelName)) {
            channels[channelName] = {};
            bridge.channelCnts[channelName] = 0;
          }
          // add to channels index
          channels[channelName][clientId] = client;
          bridge.channelCnts[channelName]++;

          // announce ready state
          setClientState(client, STATE_READY);

          // announce each peer if we have them and we're still ready
          if (hasPeers && client.state === STATE_READY) {
            for (peerId in clientPeers) {
              if (protoHas.call(clientPeers, peerId)) {
                // pass additional flag to note this peer existed
                client.fire(JOIN_EVENT, clientPeers[peerId], true);
              }
            }
          }
        },

        // notify clients of network changes
        /*
        data structure
        {                           [payload]
          mid: <guid>,
          type: "net",
          sent: <date>,
          msg: {                    [msg]
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
        }
        */
        net: function (bridge, msg) {
          // create unique peers for clients in these channels
          // remove possible "bid" member - to not reveal bridge ids
          var
            channelClients,
            clientId,
            client,
            joins = msg.joins,
            drops = msg.drops,
            peerData,
            peerId,
            peer,
            ln,
            changeSets,
            csLn,
            peeredClients,
            pcLn;


          // handle joins
          ln = joins.length;
          while (ln--) {
            // get peer data
            peerData = joins[ln];
            peerId = peerData.id;

            // get clients in this channel
            channelClients = bridge.channels[peerData.channel];
            // reset list of clients that gained peers
            peeredClients = [];

            // add a unique peer instance to clients that don't have one
            for (clientId in channelClients) {
              if (
                clientId != peerId &&
                protoHas.call(channelClients, clientId) &&
                !protoHas.call((client = channelClients[clientId]).peers, peerId)
              ) {
                addPeerToClient(client, peerData);
                // track that this client should be notified
                peeredClients.push(client);
              }
            }

            // only notify clients that gained this peer
            pcLn = peeredClients.length;
            while (pcLn--) {
              client = peeredClients[pcLn];
              client.fire(JOIN_EVENT, client.peers[peerId]);
            }
          }

          // handle drops
          ln = drops.length;
          while (ln--) {
            changeSets = [];
            // get peer data
            peerData = drops[ln];
            peerId = peerData.id;

            // get clients in this channel
            channelClients = bridge.channels[peerData.channel];

            // remove peer from each client in this channel
            for (clientId in channelClients) {
              if (
                clientId != peerId &&
                protoHas.call(channelClients, clientId)
              ) {
                client = channelClients[clientId];
                peer = client.peers[peerId];
                changeSets.push([client, peer]);
                // set client state
                peer.state = 0;
                delete client.peers[peerId];
              }
            }

            // fire drop event on each client, passing the removed peer
            csLn = changeSets.length;
            while (csLn--) {
              client = changeSets[csLn][0];
              if (client.id != peerId) {
                client.fire(DROP_EVENT, changeSets[csLn][1]);
              }
            }
          }

        },

        // handle killed bridge
        /*
        data structure
        {                           [payload]
          mid: <guid>,
          type: "die",
          sent: <date>,
          msg: <code-number>           [msg]
        }
        */
        die: function (bridge) {
          // remove from bridge now, so this bridge can't be reused by a reopening client
          bridge.deref();
          // notify clients
          bridge.destroy();
        },

        // pass-thru client message
        /*
        data structure
        {                           [payload]
          mid: <guid>,
          type: "client",
          sent: <date>,
          msg: {                    [msg]
            type: <client-type>,
            from: <guid>,
            to: [<guid>, ...],
            data: <arbitrary-data>  [data] *optional
          }
        }
        */
        client: function (bridge, msg, payload, evt) {
          var
            clients = bridge.clients,
            peerId = msg.from,
            handlers = subetha.msgType,
            handler,
            msgData,
            clientId,
            clientsLn,
            targetClients;

          // exit when there are no handlers or this type has no handler
          if (
            typeof handlers !== 'object' ||
            !protoHas.call(handlers, msg.type)
          ) {
            return;
          }

          handler = handlers[msg.type];
          targetClients = msg.to;
          msgData = msg.data;

          if (targetClients) {
            clientsLn = targetClients.length;
            // invoke handler on targeted clients
            while (clientsLn--) {
              checkAndSendCustomEvent(
                clients,
                targetClients[clientsLn],
                peerId,
                handler,
                msgData,
                msg,
                payload,
                evt
              );
            }
          } else {
            // invoke handler with all
            for (clientId in clients) {
              if (protoHas.call(clients, clientId)) {
                checkAndSendCustomEvent(
                  clients,
                  clientId,
                  peerId,
                  handler,
                  msgData,
                  msg,
                  payload,
                  evt
                );
              }
            }
          }
        }

      },

      // public API
      subetha = {

        // number of milliseconds to wait for the bridge to connect
        bridgeTimeout: 10000,

        // expose guid function
        guid: guid,

        Client: Client,

        Peer: Peer,

        EventEmitter: EventEmitter,

        protocol: protocolVersion,

        urls: {
          'public': (inFileProtocol ? 'http:' : '') + '//rawgit.com/bemson/subetha-bridge/master/public_bridge.html',
          'local': 'javascript:\'<script src="' + (inFileProtocol ? 'http:' : '') + '//rawgit.com/bemson/subetha-bridge/master/subetha-bridge.min.js"></script>\''
        },

        // collection of client types this client can process
        /*
        handler signature
          1. receiving client instance
          2. sending peer instance
          3. data (in msg)
          4. msg (in payload)
          5. payload (decoded from event)
          6. native post-message event

        data structure
        {                           [payload]
          mid: <guid>,
          type: "client",
          sent: <date>,
          msg: {                    [msg]
            type: "event",
            from: <guid>,
            to: [<guid>, ...],
            data: <event-data>      [data] *optional
          }
        }
        */
        msgType: {}

      }
    ;

    // collect netevts
    netEvts[DROP_EVENT] = 1;
    netEvts[JOIN_EVENT] = 1;
    netEvts[CHANGE_EVENT] = 1;
    netEvts[CONNECT_EVENT] = 1;
    netEvts[DISCONNECT_EVENT] = 1;

    // build ethadiv
    ethaDiv.style.display = 'none';
    ethaDiv.setAttribute('aria-hidden', 'true');
    ethaDiv.setAttribute('hidden', 'hidden');
    ethaDiv.setAttribute('data-owner', 'subetha');

    // UTILITY

    // shallow object merge
    function mix(base) {
      var
        argIdx = 1,
        source,
        member;

      for (; source = arguments[argIdx]; argIdx++) {
        for (member in source) {
          if (protoHas.call(source, member)) {
            base[member] = source[member];
          }
        }
      }
      return base;
    }

    // generates a guaranteed unique id
    function guid() {
      return guidPattern.replace(rxp_guid, guid_helper);
    }

    // guid helper, for replacing characters
    function guid_helper (c) {
      var
        r = mathRandom() * 16 | 0,
        v = c === 'x' ? r : (r & 0x3 | 0x8);

      return v.toString(16);
    }

    function isFullString(value) {
      return value && typeof value === 'string';
    }

    function resolvePeers(clientPeers, vals) {
      var
        peers = [],
        id,
        ln;

      if (!isArray(vals)) {
        vals = [vals];
      }
      ln = vals.length;

      while (ln--) {
        id = vals[ln];
        if (id instanceof Subetha.Peer) {
          id = id.id;
        }
        if (!protoHas.call(clientPeers, id)) {
          return 0;
        }
        peers.push(id);
      }
      return peers;
    }

    // FUNCTIONS

    function bridgeOnLoadHandler(bridge) {
      // if onload event fires when queued or pending...
      if (bridge.state < STATE_READY) {
        // send first postMessage to window
        // skipping utility, to avoid double-quotes
        bridge.iframe.contentWindow.postMessage(bridge.ping, '*');
        // (re)set state to pending, since we're now waiting
        bridge.state = STATE_PENDING;
        // allow half time for a response
        // bridge.dDay(subetha.bridgeDelay/2);
      } else {
        // otherwise, destroy bridge
        bridge.destroy();
      }
    }

    function removeEthaDiv() {
      if (docBody.contains(ethaDiv)) {
        // remove ethaDiv from DOM
        docBody.removeChild(ethaDiv);
      }
    }

    // routes all post messages to active bridges
    function bridgeRouter(evt) {
      var
        pkg = evt.data,
        bridge,
        bridgeState,
        payload,
        type;

      // only parse when...
      if (
        // not expecting an object
        !canPostObjects &&
        // the message is a string
        typeof pkg === 'string' &&
        // it looks like an array
        pkg.charAt(0) + pkg.charAt(pkg.length - 1) === '[]'
      ) {
        try {
          pkg = JSONparse(pkg);
        } catch (e) {
          return;
        }
      }

      /*
      evt structure
      {                             [evt]
        origin: <url>,
        data: {                     [payload]
          mid: <guid>,
          type: "...",
          sent: <date>,
          msg: {                     [msg]
            ...
          }
        }
      }
      */

      // security layer
      if (
        // an array
        isArray(pkg) &&
        // the first matches the protocol
        pkg[0] == protocolVersion &&
        // there are three elements total
        pkg.length === 3 &&
        // the second is the network of a known bridge
        protoHas.call(bridges, pkg[1]) &&
        // the bridge is pending or ready
        (bridgeState = (bridge = bridges[pkg[1]]).state) > STATE_INITIAL &&
        bridgeState < STATE_CLOSING &&
        // the third is encoded JSON object
        (payload = bridge.decode(pkg[2])) &&
        // the payload has a msg-id
        isFullString(payload.mid) &&
        // the payload has a sent date
        protoHas.call(payload, 'sent') &&
        // the payload has a message
        protoHas.call(payload, 'msg') &&
        // the payload has a known type
        protoHas.call(bridgeDataHandlers, (type = payload.type))
      ) {
        // set timer stamps
        payload.sent = new Date(payload.sent);
        // pass message to handler
        bridgeDataHandlers[type](bridge, payload.msg, payload, evt);
      }
    }

    // complete subetha initialization
    function onDomReady() {
      var
        clients = clientQueue,
        clientId;

      // set domReady flag
      domReady = 1;

      // alias body
      docBody = doc.body;

      // remove listeners
      unbind(scope, 'DOMContentLoaded', onDomReady);
      unbind(scope, 'load', onDomReady);

      // add client to resolved bridge
      addClient = function (client) {
        var
          networkId = client.url,
          bridge;

        // resolve bridge
        if (protoHas.call(bridges, networkId)) {
          bridge = bridges[networkId];
        } else {
          bridge = bridges[networkId] = new Bridge(networkId);
        }

        // add client to bridge
        bridge.addClient(client);
      };

      // remove client from bridge
      removeClient = function (client) {
        var bridge = client._bridge(privateKey);
        if (bridge) {
          bridge.removeClient(client);
        }
      };

      // dereference global queue then add all pending clients
      clientQueue = 0;
      for (clientId in clients) {
        if (protoHas.call(clients, clientId)) {
          addClient(clients[clientId]);
        }
      }
    }

    function checkAndSendCustomEvent(clients, clientId, peerId, handler, data, msg, payload, evt) {
      var
        peer,
        client;

      // this logic prevents a client from messaging itself
      if (
        // client exist
        protoHas.call(clients, clientId) &&
        // client has peer
        protoHas.call((client = clients[clientId]).peers, peerId)
      ) {
        peer = client.peers[peerId];
        handler(client, peer, data, {
          id: payload.mid,
          peer: peer,
          sent: new Date(payload.sent),
          timeStamp: evt.timeStamp
        });
      }
    }

    function setClientState(client, newState) {
      var oldState = client.state;

      // exit when not changing the state
      if (newState === oldState) {
        return;
      }

      // set new client state
      client.state = newState;
      // announce change
      client.fire(CHANGE_EVENT, newState, oldState);

      // exit if the state was changed, after this event
      if (client.state !== newState) {
        return;
      }

      if (newState === STATE_INITIAL) {
        // clear peers
        client.peers = {};
        // fire disconnect event if connected
        if (oldState > STATE_PENDING) {
          client.fire(DISCONNECT_EVENT);
        }
      }

      if (newState === STATE_READY) {
        client.fire(CONNECT_EVENT);
      }

    }

    function addPeerToClient(client, peerData) {
      // add peer to client if not the client
      client.peers[peerData.id] = new Peer(peerData, client);
    }

    // CLASSES

    // basic event emitter
    function EventEmitter() {}

    mix(EventEmitter.prototype, {
      on: function (evt, callback) {
        var me = this;

        if (
          isFullString(evt) &&
          typeof callback === 'function'
        ) {
          if (!protoHas.call(me, '_evts')) {
            // init events hash
            me._evts = {};
          }
          if (!protoHas.call(me._evts, evt)) {
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

        if (!protoHas.call(me, '_evts') || !argLn) {
          // reset if clearing all events
          me._evts = {};
        } else if (
          isFullString(evt) &&
          protoHas.call(me._evts, evt)
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
      fire: function (evt) {
        var
          me = this,
          params,
          cbs,
          cbLn,
          cbIdx,
          callbackInvoker;

        if (
          isFullString(evt) &&
          protoHas.call(me, '_evts') &&
          protoHas.call(me._evts, evt) &&
          (cbLn = (cbs = me._evts[evt]).length)
        ) {
          params = protoSlice.call(arguments, 1);
          if (params.length) {
            callbackInvoker = function (cb) {
              cb.apply(me, params);
            };
          } else {
            callbackInvoker = function (cb) {
              cb.call(me);
            };
          }
          for (cbIdx = 0; cbIdx < cbLn; cbIdx++) {
            callbackInvoker(cbs[cbIdx]);
          }
        }

        return me;
      }
    });

    function Bridge(network) {
      var
        bridge = this,
        iframe = doc.createElement('iframe'),
        cipher = new Morus();

      bridge.iframe = iframe;
      bridge.id = network;
      bridge.cipher = cipher;
      bridge.clients = {};
      bridge.channels = {};
      bridge.channelCnts = {};
      // payload for first load
      bridge.ping = [
        // protocol version
        protocolVersion,
        // speaker key
        speakerKey,
        // bridge identifier
        network,
        // encoding cipher
        cipher.cipher()
      ].join('`');

      // if not already enabled, subscribe to events
      if (!bridgeCnt++) {
        bind(scope, 'message', bridgeRouter);
        bind(scope, 'unload', removeEthaDiv);
      }

      // scope iframe!onload handler to this instance
      bridge.onLoad = function () {
        bridgeOnLoadHandler(bridge);
      };

      bind(iframe, 'load', bridge.onLoad);

      if (protoHas.call(subetha.urls, network)) {
        // use aliased network aliased
        iframe.src = subetha.urls[network];
      } else {
        // use raw network
        iframe.src = network;
      }

      // give bridge time to connect
      bridge.dDay(subetha.bridgeTimeout);

      // add bridge to ethadiv
      ethaDiv.appendChild(iframe);

      // ensure iframe is (now) in the dom
      if (!bridge.inDom()) {
        docBody.appendChild(ethaDiv);
      }

    }

    mix(Bridge.prototype, {

      // number of failed cipher decoding attempts
      failures: 0,

      // bridges start queued, since they are immediately added to the dom
      state: STATE_QUEUED,

      // number of clients
      cnt: 0,

      // add client to bridge
      addClient: function (client) {
        var
          bridge = this,
          clients = bridge.clients,
          clientId = client.id;

        // init new clients
        if (!protoHas.call(clients, clientId)) {
          // uptick tally
          bridge.cnt++;
          // expose bridge via closured method
          client._bridge = function (val) {
            return val === privateKey && bridge;
          };
          // add to client queue
          clients[clientId] = client;
        }

        // if bridge is ready now...
        if (bridge.state == STATE_READY) {
          // authenticate this client
          bridge.auth(client);
        }

      },

      // remove client from bridge, via client command
      removeClient: function (client) {
        var
          bridge = this,
          clientId = client.id,
          channelName = client.channel;

        // if other clients will remain
        if (--bridge.cnt) {
          // deference client
          delete bridge.clients[clientId];
          // when authed
          if (client.state > STATE_QUEUED) {
            // remove client from channel
            delete bridge.channels[channelName][clientId];
            // when this is the last client in the channel
            if (bridge.channelCnts[channelName]-- == 1) {
              delete bridge.channelCnts[channelName];
            }
          }

          // discard this one client
          bridge.drop(client);
        } else {
          // simply destroy the entire bridge
          bridge.destroy();
        }
      },

      // authenticate client (with network)
      auth: function (client) {
        var creds;
        // set client to pending
        setClientState(client, STATE_PENDING);
        // if still pending, then send client to bridge
        if (client.state == STATE_PENDING) {
          creds = client.credentials;
          if (!isArray(creds)) {
            creds = [creds];
          }
          // authenticate client
          this.send('auth', {
            id: client.id,
            channel: client.channel,
            creds: creds
          });
        }
      },

      destroy: function () {
        var
          bridge = this,
          prevBridgeState = bridge.state,
          iframe = bridge.iframe,
          clients = bridge.clients,
          clientId;

        // kill any destruction timer
        bridge.dDay();

        // prevent clients from transmitting
        bridge.state = STATE_CLOSING;

        // dereference and close clients
        bridge.clients = {};
        bridge.cnt = 0;
        for (clientId in clients) {
          if (protoHas.call(clients, clientId)) {
            bridge.drop(clients[clientId]);
          }
        }

        // exit if new clients were created
        if (bridge.cnt) {
          // restore bridge state
          bridge.state = prevBridgeState;
          // abort destruction
          return;
        }

        bridge.deref();

        // kill load listener for this bridge
        unbind(iframe, 'load', bridge.onLoad);

        // if this will be the last bridge
        if (!--bridgeCnt) {
          // stop listening for messages
          unbind(scope, 'message', bridgeRouter);
          // stop listening for unload
          unbind(scope, 'unload', removeEthaDiv);
          removeEthaDiv();
        }

        if (ethaDiv.contains(iframe)) {
          // remove bridge from ethadiv
          ethaDiv.removeChild(iframe);
        }
      },

      deref: function () {
        // dereference bridge to stop receiving messages
        delete bridges[this.id];
      },

      // remove client from bridge
      drop: function (client) {
        var clientState = client.state;

        // remove custom bridge method
        delete client._bridge;

        // for pending and ready clients...
        if (clientState > STATE_QUEUED && clientState < STATE_CLOSING) {

          // inform network of client departure
          this.send('drop', client.id);

          // clean up connections
          if (clientState == STATE_READY) {
            // tell client it's closing
            setClientState(client, STATE_CLOSING);
          }
        }

        // dereference all peers
        client.peers = {};

        // if client is still closing
        if (client.state == STATE_CLOSING) {
          // set client state (now)
          setClientState(client, STATE_INITIAL);
        }
      },

      // ensures an incoming message is valid
      decode: function (coded) {
        var
          bridge = this,
          cipher = bridge.cipher,
          data;

        // smell test before expensive try/catch
        if (
          // coded is a string
          isFullString(coded) &&
          // decodes
          (data = cipher.decode(coded)) &&
          // has json within decoded string (accounts for random beginning and ending chars)
          (data = r_extractJSON.exec(data))
        ) {
          // exit if parsing failed
          try {
            data = JSONparse(data[1]);
            // increment starting index (the bridge has already done this)
            cipher.shift++;
            // return data object
            return data;
          } catch (e) {
            // silent exception
          }
        }

        // check failure tolerance
        if (++bridge.failures === 3) {
          // destroy bridge
          bridge.destroy();
        }

        // fail decoding
        return 0;
      },

      // specifies when bridge iframe is in the page ethadiv and dom
      inDom: function () {
        var iframe = this.iframe;

        return ethaDiv.contains(iframe) && docBody.contains(iframe);
      },

      // (dooms-day) wait before destroying bridge
      // stops timer when called without params
      dDay: function (ms) {
        var bridge = this;

        // stop current timebomb
        clearTimeout(bridge.timer);

        // start new timebomb
        if (ms) {
          bridge.timer = setTimeout(function () {
            bridge.destroy();
          }, ms);
        }
      },

      // send protocol message to bridge
      send: function (type, msg) {
        var
          bridge = this,
          msgId;

        // only send when ready
        if (bridge.state != STATE_READY) {
          return 0;
        }

        msgId = guid();
        postMessage(
          bridge.iframe.contentWindow,
          // protocol message
          {
            // key needed by bridge
            key: speakerKey,
            // message identifier
            mid: msgId,
            // type of message
            type: type,
            // message content
            msg: msg
          }
        );

        // return message id
        return msgId;
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

      id: '',

      // default channel
      channel: 'lobby',

      // default url
      url: 'local',

      // connection state
      state: STATE_INITIAL,

      // returns closured bridge when connected and passed correct key
      _bridge: function () {
        return false;
      },

      // add client to bridge queue
      open: function (network) {
        var
          me = this,
          channel = me.channel,
          url = me.url,
          args = arguments,
          state = me.state,
          pos;

        // process the given channel...
        if (isFullString(network)) {
          pos = network.indexOf('@');
          if (~pos) {
            channel = network.substring(0, pos) || channel;
            url = network.substring(pos + 1) || url;
          } else {
            channel = network;
          }

          // update access credentials if given
          if (args.length > 1) {
            me.credentials = protoSlice.call(args, 1);
          }
        }

        // if url looks like a domain, add protocol safe prefix
        if (r_domainish.test(url)) {
          url = urlPrefix + url;
        }

        // when already open-ed/ing
        if (state > STATE_PENDING) {
          // exit if same channel and url
          if (channel == me.channel && url == me.url) {
            return;
          }
          // close existing connection
          me.close();
          // capture new (closed) state
          state = me.state;
        }

        // set resolved network
        me.channel = channel;
        me.url = url;

        // open if at initial state
        if (state < STATE_PENDING) {

          // set id now
          me.id = guid();
          // update state to queued
          setClientState(me, STATE_QUEUED);
          // if state hasn't changed since queuing (i.e., they haven't closed the client)
          if (me.state == STATE_QUEUED) {
            // add to global/bridge queue
            addClient(me);
          }
        }

        return me;
      },

      // remove from global/bridge queue
      close: function () {
        var
          client = this,
          state = client.state;

        if (state > STATE_INITIAL && state < STATE_CLOSING) {
          // remove from global queue or bridge
          removeClient(client);
        }

        return client;
      },

      // send arbitrary client message
      _transmit: function (type, peers, data) {
        var
          client = this,
          bridge = client._bridge(privateKey);

        if (
          bridge &&
          bridge.state == STATE_READY &&
          client.state == STATE_READY &&
          isFullString(type) &&
          !protoHas.call(netEvts, type) &&
          (
            !peers ||
            (peers = resolvePeers(client.peers, peers))
          )
        ) {
          return bridge.send(
            'client',
            {
              type: type,
              from: client.id,
              to: peers ? [].concat(peers) : 0,
              data: data
            }
          );
        }

        return false;
      }

    });

    // proxy for communicating with a specific peer
    function Peer(peerData, client) {
      var me = this;

      me._client = client;
      if (peerData) {
        me.id = peerData.id;
        me.origin = peerData.origin;
        me.start = new Date(peerData.start);
        me.channel = peerData.channel;
      }
    }

    mix(Peer.prototype, {

      // indicates peer is usable
      state: STATE_READY

    });


    // if there is no postMessage method
    if (typeof scope.postMessage !== 'function') {

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
  Array, Date, Math, JSON, Object, RegExp, this
);
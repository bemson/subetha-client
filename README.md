# SubEtha-Client

Define, send and receive SubEtha message types

version 0.0.0-alpha
by Bemi Faison


## Description

SubEtha-Client (or Client) is a supporting library within the SubEtha messaging architecture. A client sends and receives messages with network peers - other clients, connected to the same channel and url origin.

Clients primarily implement the SubEtha protocol for communicating with Bridges, and provide a framework for communicating with each other.

**Note:** Please see the [SubEtha project page](https://github.com/bemson/subetha), for important background information, plus development, implementation, and security considerations.


## Usage

The Client module runs in a web page that is _shared_ with your application code. To join a network, Clients work with the SubEtha-Bridge module, via iframes. To exchange messages, Clients send and receive pre-defined message _types_.

See the [Peer-Events](https://github.com/bemson/subetha-client-pe) and [Ad Hoc-Exchange](https://github.com/bemson/subetha-client-ax) modules, for examples that use this module for custom messaging.

### Networking with SubEtha

The Client module manages the process of joining a SubEtha network. One part involves loading a Bridge module within an iframe. The other authorizes a Client on the network. (Since the first part risks network error, it is limited to 10 seconds - a threshold you may change via the `Subetha.bridgeTimeout` member.)

Client instances start this connection sequence, by invoking the `Client#open()` method.

```js
var client = new Subetha.Client();
client.open('some channel@example.com/bridge.html');
```

The method accepts a network identifier as it's first argument; a string, formatted as "channel@url", where _channel_ is an arbitrary value, and _url_ is a web page hosting the Bridge module. For convenience, "@url" may be an alias, referencing a key from `Subetha.urls`.

#### Connecting to common bridges

The Client module supplies two bridges by default: the "local" and "public" aliases.

The "local" alias points to a JavaScript-URL that loads the Bridge module from a github CDN. As a dynamic iframe, the bridge utilizes the same domain as the client. Use this when you only want to communicate with windows to your own application/domain.

The "public" alias points to a webpage on a github CDN. This bridge utilizes the CDN's domain. Use when you want to communicate with applications in different domains.

By default - i.e., if `Client#open()` were called with no arguments - Clients will connect to "lobby@local", or the "lobby" channel of the "local" bridge url alias.

#### Monitoring the connection status

Once connected, Clients fire a _::connect_ network event. Similarly, you can subscribe to the _::error_ and/or _::auth-fail_ events. Any of these events inform when and how a connection attempt completes.

```js
client.on('::connect', function () {
  console.log('Woot!');
});

client.on('::error', function () {
  console.log('Something went wrong...');
});

client.on('::auth-fail', function () {
  console.log('I hate rejection.');
});
```

Likewise, Clients fires a _::disconnect_ network event, once disconnected. This event only occurs after having successfully connected to a network - i.e., if the _::connect_ event fired.

```js
client.on('::disconnect', function () {
  console.log('No longer connected');
});
```

#### Tracking channel peers

Connected clients receive a list of existing peers (in their channel), via the `peers` property. Each peer is a `Subetha.Peer` instance, linked to the client via the `Peer@_client` property. (The underscore implies [private by convention](http://code.tutsplus.com/articles/9-confusing-naming-conventions-for-beginners--net-15584); the property should not be used directly.)

```js
var person = new Subetha.Client().open('party@public');

person.on('::connect', function () {
  var
    me = this,
    peerId,
    count = 0;

  for (peerId in me.peers) {
    if (peers.hasOwnProperty(peerId)) {
      count++;
    }
  }
  console.log('Partygoers so far: %d', count);
});
```

Clients can observe newly added peers by subscribing to the _::join_ event. Likewise departing peers can be observed via the _::drop_ event. Both events pass the effected Peer instance.

```js
person.on('::join'. function (peer) {
  console.log('Welcome peer %s', peer.id);
});

person.on('::drop', function (peer) {
  console.log('Sorry to see you go %s', peer.id);
});
```

**Note:** A _::join_ event is also fired per existing peer, once a client connects. These events pass an additional truthy flag, indicating that the peer was present before the client connected.

#### Connecting to protected bridges

Some bridges may be coded to require some form of access verification. You can use the `Client#open()` method or the `Client@credentials` property to pass authorization credentials. Bridges that deny authorization cause the client to fire an _::auth-fail_ network event.

Below demonstrates two clients that use each approach to open a connection.

```js
var
  manual = new Subetha.client(),
  automatic = new Subetha.client();

manual.channel = 'do it';
manual.url = 'forme';
manual.credentials = ['user', 'access-token'];

// uses the properties above
manual.open();

// sets the properties above
automatic.open('do it@forme', 'user', 'access-token');

console.log('channel: "%s"', automatic.channel); // channel: "do it"
console.log('url: "%s"', automatic.url); // url: "forme"
console.log('credentials: %s', automatic.credentials); // credentials: "user", "access-token"
```

**Note:** This example assumes the "forme" bridge alias was already defined.

### Messaging with SubEtha

SubEtha allows you to send arbitrary message types, and requires defining the message types you want to receive. In general, Clients should be able to receive the message types they send. Thus, it's recommended that both implementations be grouped in the same code base, as a module or plugin. This allows you to share your messaging logic and communicate with other applications and/or windows.

Below demonstrates code that enables both sending and receiving the message type "hug".

```js
// add Client method to broadcasts hugs
Subetha.Client.prototype.hugAll = function (kind) {
  this._transmit(
    'hug',            // type
    null,             // target all peers (when falsy)
    kind || 'normal'  // payload
  );
};

// add Peer method to send one hug
Subetha.Peer.prototype.hugOne = function () {
  this._client._transmit(
    'hug',            // type
    this,             // target this peer
    'one on one'      // payload
  );
};

// add a hug message handler
Subetha.msgType.hug = function (toClient, fromPeer, payload) {
  console.log(
    '%s received a %s hug from %s!',
    toClient.id,
    payload,
    fromPeer.id
  );
};
```

In practice, the details of the "hug" message type are hidden by these prototyped methods and the static message-type handler. Below creates a `greeter` client that eventually sends a "hug" message to the `newb` client (depending on whom joins the network first).

```js
var
  greeter = new Subetha.Client().open('support group'),
  newb = new Subetha.Client().open('support group');

greeter.on('::connect', function () {
  greeter.hugAll('big');
});

greeter.on('::join', function (peer) {
  peer.hugOne();
});
```

**Note:** These code snippets work when SubEtha is loaded via a SCRIPT tag. Additional wrappers would let them work in AMD/CJS environments.

#### Sending messages

SubEtha allows connected clients to send arbitrary messages to peers (i.e., clients in the same channel and url origin). All messages have a type, payload, and recipient(s). The payload is converted to JSON automatically, but must adhere to the [structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/Guide/API/DOM/The_structured_clone_algorithm), or unexpected errors may occur.

Messages are sent via the `Client#_transmit()` method, which is intended for use via methods you prototype on the `Subetha.Client` and/or `Subetha.Peer` classes. This approach allows you to hide implementation details, such as the payload structure and/or message validation.

```js
Subetha.Client.prototype.canSend = false;

// only transmits when local logic permits
Subetha.Client.prototype.sendSomething = function () {
  if (this.canSend) {
    this._transmit('some_message');
  }
};
```

The Client module only checks to ensure both the client and recipient(s) are active peers. (You can avoid such checks by broadcasting your message - i.e., pass a falsy value as the second parameter.) If the message is cleared for transmission, then the `#_transmit()` method returns `true`. Otherwise, `false`.

**Note:** A successful transmission does _not_ imply that the message was received or processed by it's recipient(s).

#### Receiving messages

The Client module only routes messages that have an active recipient and sender, plus a handler function for the given message type (or, "message handler"). Message handlers must be set in the `Subetha.msgType` collection, keyed under their target message type.

For example, the code below adds a message handler for the message type "subetha/foo".

```js
Subetha.msgType['subetha/foo'] = function () {
  console.log('a client received a "subetha/foo" message!');
};
```

In this way, message types are a kind of namespace which you must choose carefully. In a mixed environment your handler may be overridden, or receive messages with an unexpected structure. Verbosity is recommended, since the message type will often be hidden to your application logic.

The Client module invokes message handlers with the following signature.

  1. _toClient_ - The Client instance receiving the message.
  2. _fromPeer_ - The Peer instance that sent the message. This instance comes from the receiving Client's own `peers` collection.
  3. _payload_ - The arbitrary value sent from the peer, via the `#transmit()` method.
  4. _details_ - Message meta-data, such as routing and metrics.
    * `id` - The message id.
    * `sent` - The date the message was sent (as a `Date` instance).
    * `timeStamp` - The date the message was received (in milliseconds).
    * `peers` - An array of all recipient ids. (This is empty for broadcasts.)

Below demonstrates a message handler that validates the message content and meta-data, before triggering events in the client.

```js
Subetha.msgType.paint = function (toClient, fromPeer, payload, details) {
  var oldHue = toClient.hue;
  if (
    // ensure the payload is a hex-RGB string
    /^[a-f0-9]{6}$/i.test(payload) &&
    // ensure this client was the only targeted recipient
    details.peers.length == 1 &&
    // the message didn't take too long to arrive
    details.timeStamp - details.sent < 100 &&
    // the sender was from a specific origin
    /\bexample.com\b/.test(fromPeer.origin)
  ) {
    toClient.hue = payload;
    toClient.fire('hueChange', payload, oldHue);
  }
};
```


## API

Below is reference documentation for the SubEtha-Client module. This module provides the `Subetha` namespace, which features several classes, exposed for extension and customization.

**Note:** Instance methods are prefixed with a pound-symbol (`#`). Instance properties are prefixed with an at-symbol (`@`). Static members are prefixed with a double-colon (`::`).


### Subetha::Client

Creates a new Client instance.

```
var client = new Subetha.Client();
```

This class inherits from `Subetha.EventEmitter`.

##### Network events

Client instances fire the following network events, prefixed by a double-colon (`::`).

  * **::auth-fail** - Triggered when a connection attempt is denied.
  * **::connect** - Triggered when a connection is established.
  * **::disconnect** - Triggered when the client connection ends.
  * **::drop** - Triggered when a peer leaves the channel.
    * `peer`: _(Peer)_ References the recently removed `Subetha.Peer` instance.
  * **::join** - Triggered when a peer joins the channel.
    * `peer`: _(Peer)_ References the newly added `Subetha.Peer` instance.
  * **::readyStateChange** - Triggered when `@state` changes. This event precedes _::auth-fail_, _::connect_ and _::disconnect_ events.
    * `newState`: _(number)_ The integer of the new state.
    * `oldState`: _(number)_ The integer of the old state.

#### Client#close()

Close the client connection.

```
client.close();
```

#### Client#open()

Establish a connection to a specific channel and (bridge) url.

```
client.open([network [, credentials, ... ]);
```

  * **network**: _(string)_ The _channel_ and _bridge_ to authorize, in the format "channel@url". The parsed value updates the `@channel` and/or `@url` properties.
  * **credentials**: (_mix_) Any additional arguments replace `@credentials` and are sent to the bridge.

Opening closes the existing connection, unless it is the same channel and bridge url.

#### Client#_transmit()

Send a message to one or more peers.

```
client._transmit(type [, peers [, payload]]);
```

   * **type**: _(string)_ The message type.
   * **peers**: _(string[]|peer[])_ One or an array of recipient peer ids and/or instances. When omitted or falsy, the message is broadcast to all channel peers.
   * **payload**: _(mix)_ An arbitrary value passed to a message type handler.

**Note:** Peers must have a message handler that matches the type sent, in order for them to both receive and process your message.

Returns `true` when the message is successfully sent. Otherwise `false`.

#### Client@channel

A string reflecting the network channel. The default value is "lobby".

#### Client@credentials

A value sent when establishing a client connection.

The value is converted to an array before transmission. A value of `null` or `undefined` is ignored.

#### Client@id

A unique hash to identify this instance in a network. This property is updated during each connection attempt.

#### Client@state

A number reflecting the current connection status. There are five possible states:

  * `0` - The _initial_ state, when there is no connection.
  * `1` - The _queued_ state, when a connection request is queued.
  * `2` - The _pending_ state, when a connection request has been sent.
  * `3` - The _ready_ state, when a connection has been established.
  * `4` - The _closing_ state, when the connection is closing.

**Note:** The _::readyStateChange_ event fires after this value changes.

#### Client@url

A string reflecting the network url or alias. The default value is "local".

### Subetha::EventEmitter

Creates a new EventEmitter instance.

```
var eventer = new Subetha.EventEmitter();
```

This class is _not_ meant for direct instantiation.

#### EventEmittter#fire()

Triggers callbacks, subscribed to this event.

```
eventer.fire(event [, args, ... ]);
```

   * **event**: _(string)_ The event to trigger.
   * **args**: _(mix)_ Remaining arguments that should be passed to all attached callbacks.

#### EventEmittter#on()

Subscribe a callback to an event.

```
eventer.on(event, callback);
```

   * **event**: _(string)_ An arbitrary event name.
   * **callback**: _(function)_ A callback to invoke when the event is fires.

#### EventEmittter#off()

Unsubscribe callback(s) from an event. When invoked with no arguments, all subscriptions are removed.

```
eventer.off([event [, callback]]);
```

   * **event**: _(string)_ The event to unsubscribe. When omitted, all event subscribers are removed.
   * **callback**: _(function)_ The callback to detach from this event. When omitted, all callbacks are detached from this event.

### Subetha::Peer

Creates a new Peer instance.

```
var peer = Subetha.Peer(cfg, client);
```

  * **cfg**: _(object)_ Configuration values for peer properties.
  * **client**: _(Client)_ The client instance that will reference this peer.

This class is _not_ meant for direct instantiation.

#### Peer@channel

A string reflecting the network channel.

#### Peer@id

A hash to uniquely identify this peer in a network.

#### Peer@origin

The url origin of the web page hosting the peer.

#### Peer@start

A `Date` instance indicating when the peer joined the network.

### Subetha::guid()

Returns a unique hash of characters.

```
var hash = Subetha.guid();
```

### Subetha::bridgeTimeout

The number of milliseconds to wait before aborting a connection attempt with a Bridge module. The default value is `10000` or 10 seconds.

### Subetha::msgType

Hash of message handling functions, keyed by the message type they handle. (For instance, a built-in type is "event", for handling event messages.) This property is meant for library authors, extending the SubEtha module.

Below is the call signature passed to message handlers.

  1. _toClient_ - The Client instance receiving the message.
  2. _fromPeer_ - The Peer instance that sent the message.
  3. _payload_ - A custom, arbitrary value sent from the peer.
  4. _details_ - Message meta-data.
    * `id` - The message id.
    * `sent` - The date the message was sent (as a `Date` instance).
    * `timeStamp` - The date the message was received (in milliseconds).
    * `peers` - An array of recipient ids. (This is empty for broadcasts.)

### Subetha::protocol

The [SemVer](http://semver.org) compatible version of the SubEtha protocol supported by this module.

### Subetha::urls

Hash of urls keyed by an alias. This collection is used to resolved the client url when establishing a connection. The default members are:

  * `local`: A JavaScript URL that loads a publicly hosted copy of Subetha.
  * `public`: A publicly hosted bridge.

### Subetha::version

The [SemVer](http://semver.org) compatible version of the Client module.


## Installation

SubEtha-Client works within, and is intended for, modern JavaScript browsers. It is available on [bower](http://bower.io/search/?q=subetha-client), [component](http://component.github.io/) and [npm](https://www.npmjs.org/package/subetha-client) as a [CommonJS](http://wiki.commonjs.org/wiki/CommonJS) or [AMD](http://wiki.commonjs.org/wiki/Modules/AsynchronousDefinition) module.

If a SubEtha-Client isn't compatible with your favorite runtime, please file an issue or pull-request (preferred).

### Dependencies

SubEtha-Client depends on the following modules:

  * [Morus](https://github.com/bemson/morus)

SubEtha-Client also uses the following ECMAScript 5 and HTML 5 features:

  * [JSON.parse](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse)
  * [JSON.stringify](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
  * [localStorage](http://diveintohtml5.info/storage.html)
  * [postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window.postMessage)

You will need to implement shims for these browser features in unsupported environments. Note however that postMessage and localStorage shims will only allow this module to run without errors, not work as expected.

### Web Browsers

Use a `<SCRIPT>` tag to load the _subetha-client.min.js_ file in your web page. (The file includes the module dependencies for your convenience.) Doing so, adds `Subetha` to the global scope.

```html
  <script type="text/javascript" src="path/to/subetha-client.min.js"></script>
  <script type="text/javascript">
    // ... SubEtha dependent code ...
  </script>
```

**Note:** The minified file was compressed by [Closure Compiler](http://closure-compiler.appspot.com/).

### Package Managers

  * `npm install subetha-client`
  * `component install bemson/subetha-client`
  * `bower install subetha-client`

### AMD

Assuming you have a [require.js](http://requirejs.org/) compatible loader, configure an alias for the SubEtha-Client module (the term "subetha-client" is recommended, for consistency). The _subetha-client_ module exports a module namespace.

```js
require.config({
  paths: {
    'subetha-client': 'my/libs/subetha-client'
  }
});
```

Then require and use the module in your application code:

```js
require(['subetha-client'], function (Subetha) {
  // ... SubEtha dependent code ...
});
```

**Warning:** Do not load the minified file via AMD, since it includes SubEtha-Client dependencies, which themselves export modules. Use AMD optimizers like [r.js](https://github.com/jrburke/r.js/), in order to roll-up your dependency tree.


## License

SubEtha is available under the terms of the [Apache-License](http://www.apache.org/licenses/LICENSE-2.0.html).

Copyright 2014, Bemi Faison
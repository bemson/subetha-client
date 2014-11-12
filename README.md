# SubEtha-Client

SubEtha Client API

version 0.0.0-alpha
by Bemi Faison


## Description

SubEtha-Client (or Client) is a supporting library within the SubEtha messaging architecture. A client establishes a connection with a SubEtha-Bridge, and can access peers in the same "network" - i.e., the channel and url origin.

Clients primarily implement the SubEtha protocol for communicating with Bridges, and provide a framework for handling messages between peers.

**Note:** Please see the [SubEtha project page](https://github.com/bemson/subetha), for important background information, plus development, implementation, and security considerations.


## Usage

The Client module runs in a web page that is shared with your application code. Clients create and manage Bridge connections, using iframes and postMessage. Clients communicate to each other through client message _types_ - a wrapper for arbitrary message structures.


### Connecting to a bridge

### Sending a message

### Handling a message

Message handlers are member-functions of the `Subetha.msgType` namespace. In order for a message to be processed by the client, it's type must match a member key.

```js
Subetha.msgType.color = function () {

};
```

The message handler receives the following signature.

  * `client` - The Client instance receiving the message
  * `peer` - The Peer instance whom sent the message
  * `event` - A unique object, describing the message event
  * `payload` - The entire message, as received on the network

## API

Below is reference documentation for the SubEtha-Client module. This module provides the Subetha namespace, which features several classes, exposed for extension and customization.

**Note:** Instance methods are prefixed with a pound-symbol (`#`). Instance properties are prefixed with an at-symbol (`@`). Static members are prefixed with a double-colon (`::`).


### Subetha::Client

Creates a new Client instance.

```
var client = new Subetha.Client();
```

This class inherits from `Subetha.EventEmitter`.

##### Client event object

Client events are messages sent by other peers (via the `Peer#send()` and `Client#send()` methods). Callbacks receive the following normalized _event object_, along with any additional message parameters.

  * `data` - Array of additional message parameters given.
  * `id` - Unique identifier for this message.
  * `peer` - The peer that sent this message.
  * `sent`:  The time (as a Date instance) when the message was sent
  * `timeStamp`: The time (in milliseconds) when the event occurred.
  * `type` - The event type of this message.

##### Network events

Instances fire the following _network_ events - as opposed to _client_ events - prefixed by a double-colon (`::`). Network events do not pass a common event object, like with client events.

  * **::connect** - Triggered when a connection is established.
  * **::disconnect** - Triggered when the client connection ends.
  * **::drop** - Triggered when a peer leaves the channel.
    * `peer`: _(Peer)_ References the recently removed `Subetha.Peer` instance.
  * **::join** - Triggered when a peer joins the channel.
    * `peer`: _(Peer)_ References the newly added `Subetha.Peer` instance.
  * **::readyStateChange** - Triggered when `@state` changes. This event precedes the _::connect_ and _::disconnect_ events, respectively.
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

Opening closes existing connections, unless it is the same network.

#### Client#_bridge()

A closured method that only returns a bridge handle when passed a private value. All other invocations return `false`.

#### Client#_transmit()

Sends an arbitrary message to some or all peers.

```
client._transmit(type [, peers [, data]]);
```

   * **type**: _(string)_ The message type.
   * **peers**: _(string[]|peer[])_ One or an array of recipient peers (ids or instances). When omitted or falsy, the message is broadcast to all peers.
   * **data**: _(mix)_ An arbtrary value passed to the message type handler of the recieving peer.

Returns `true` when the message is successfully sent. Otherwise `false`.

**Note:** This method should _not_ be invoked directly, but by library authors extending the SubEtha module.

#### Client@channel

A string reflecting the network channel. The default value is "lobby".

#### Client@credentials

A value sent when establishing a client connection. The `null` or `undefined` are ignored.

#### Client@id

A hash to uniquely identify this instance in a network. This property changes when establishing a (new) connection.

#### Client@state

A number reflecting the connection status. There are four possible states:

  * **0**: The _initial_ state, when there is no connection.
  * **1**: The _queued_ state, when a connection request is queued.
  * **2**: The _pending_ state, when a connection request has been sent.
  * **3**: The _ready_ state, when a connection has been established.
  * **4**: The _closing_ state, when the connection is closing.

**Note:** The _::readyStateChange_ event fires when this value changes.

#### Client@url

A string reflecting the network url or alias. The default value is "local".

### Subetha::EventEmitter

Creates a new EventEmitter instance.

```
var eventer = new Subetha.EventEmitter();
```

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

Creates a new Peer instance. This class is _not_ meant for direct instantiation.

```
var peer = Subetha.Peer(cfg, client);
```

  * **cfg**: _(object)_ Configuration values for peer properties.
  * **client**: _(Client)_ The client instance that will reference this peer.

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

The number of milliseconds to wait before aborting a connection attempt. The default value is `8000` or eight seconds.

### Subetha::msgType

Hash of message handling functions, keyed by the message type they handle. (For instance, a built-in type is "event", for handling event messages.) This property is meant for library authors, extending the SubEtha module.

Below is the call signature passed to message handlers.

  * **client** - The recipient client, targeted by this message.
  * **peer** - The peer that sent the message.
  * **event** - A unique event object, to use as a base for this message and client.
    * `id`: The message identifier
    * `peer`: The Peer instance that sent this message
    * `sent`:  The time (as a Date instance) when the message was sent
    * `timeStamp`: The time (in milliseconds) when the event occurred
  * **data** - The message data, as sent via `#_transmit()` by the peer.
  * **payload** - The entire client message, as received on the network.

Below is the JSON structure of the _payload_ argument.

```
{                         // payload
  mid: <guid>,            // payload id
  type: "client",         // payload class
  sent: <date>,           // send date
  msg: {                  // payload message
    from: <guid>,         // peer id
    to: [<guid>, ...],    // client id(s)
    type: <message-type>, // message type
    data: <message-data>  // message data
  }
}
```

### Subetha::protocol

The [SemVer](http://semver.org) compatible version of the SubEtha protocol supported by this module.

### Subetha::urls

Hash of urls keyed by an alias. This collection is used to resolved the client url when establishing a connection. The default members are:

  * `local`: A JavaScript URL that loads a publicly hosted copy of Subetha.
  * `public`: A publicly hosted bridge.


## Installation

SubEtha works within, and is intended for, modern JavaScript browsers. It is available on [bower](http://bower.io/search/?q=subetha), [component](http://component.github.io/) and [npm](https://www.npmjs.org/package/subetha) as a [CommonJS](http://wiki.commonjs.org/wiki/CommonJS) or [AMD](http://wiki.commonjs.org/wiki/Modules/AsynchronousDefinition) module.

If a SubEtha isn't compatible with your favorite runtime, please file an issue or pull-request (preferred).

### Dependencies

SubEtha depends on the following modules:

  * [Morus](https://github.com/bemson/morus)

SubEtha-Client also uses the following ECMAScript 5 and HTML 5 features:

  * [JSON.parse](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse)
  * [JSON.stringify](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
  * [localStorage](http://diveintohtml5.info/storage.html)
  * [postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window.postMessage)

You will need to implement shims for these browser features in unsupported environments. Note however that postMessage and localStorage shims will only allow this module to run without errors, not work as expected.

### Web Browsers

Use a `<SCRIPT>` tag to load the _subetha-client.min.js_ file in your web page. The file includes SubEtha dependencies for your convenience. Doing so, adds `Subetha` to the global scope.

```html
  <script type="text/javascript" src="path/to/subetha-client.min.js"></script>
  <script type="text/javascript">
    // ... SubEtha dependent code ...
  </script>
```

**Note:** The minified file was compressed by [Closure Compiler](http://closure-compiler.appspot.com/).

This plugin is bundled in the SubEtha module.

### Package Managers

  * `npm install subetha-client`
  * `component install bemson/subetha-client`
  * `bower install subetha-client`

### AMD

Assuming you have a [require.js](http://requirejs.org/) compatible loader, configure an alias for the SubEtha module (the term "subetha" is recommended, for consistency). The _subetha_ module exports a module namespace.

```js
require.config({
  paths: {
    subetha: 'my/libs/subetha'
  }
});
```

Then require and use the module in your application code:

```js
require(['subetha'], function (Subetha) {
  // ... SubEtha dependent code ...
});
```

**Warning:** Do not load the minified file via AMD, since it includes SubEtha dependencies, which themselves export modules. Use AMD optimizers like [r.js](https://github.com/jrburke/r.js/), in order to roll-up your dependency tree.

## Considerations

SubEtha is an **experimental project in alpha development.** Testing is non-existent. Production deploys are discouraged, and done at your own risk.

The following sub-sections express areas that are under active or planned development and/or improvement.

### Security

As a new "pipe", SubEtha intends to be as robust and secure as TCP/IP and SSL connections. However, since this is _only_ an ideal: **security is as security does.** Do not send with SubEtha, that which you do not want to share.

### Capacity

Despite localStorage allotting 5Mb per domain, SubEtha does not check or assess message size. Do **not** send base64 encoded files... yet.

### Encoding/Decoding

SubEtha currently encodes and decodes _outgoing_ messages (from bridge to the client) synchronously. Large messages will likely cause noticeable lag.

## Shout outs

 * [William Kapke-Wicks](https://github.com/williamwicks/) - Inspired me to explore [storage events](http://html5demos.com/storage-events) and published [scomm](https://github.com/williamwicks/scomm).
 * Shankar Srinivas - Original cheerleader for this (and all things non-work related).
 * [Chris Nojima](https://github.com/cnojima) - Saw the forest when I saw trees.
 * [Mathias Buus](https://github.com/mafintosh) - Random guy who suggested the random bootstrap delay.
 * [Oakland JS](http://oaklandjs.com) - One brilliant hive mind of support and ingenuity!

## License

SubEtha is available under the terms of the [Apache-License](http://www.apache.org/licenses/LICENSE-2.0.html).

Copyright 2014, Bemi Faison
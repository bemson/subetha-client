# SubEtha-Client

Define, send and receive SubEtha messages

by Bemi Faison


## Description

SubEtha-Client (or, Client) is a core component of the SubEtha messaging architecture. The Client module connects to SubEtha networks, authorizes clients, and allows exchanging arbitrary messages with peers.

Below is a trivial example using the Client API.

```js
var agent = new Subetha.Client();

agent.open()
  .on('::connect', function () {
    console.log('Hello Network!');
    this._transmit('ping!')
      .catch(function (err) {
        console.log('Need to configure message types!');
        this.close();
      });
  })
  .on ('::disconnect', function () {
      console.log('Bye Bye!');
  });
```

 > Please see the [SubEtha project page](https://github.com/bemson/subetha), for important background information, plus development, implementation, and security considerations.


## Usage

The Client module is designed to operate in top-level web contexts (i.e., a non-framed browser window) shared by your application. To join a network, clients negotiate with "bridges" - distinct modules that gate access and route messages within a server's domain. To exchange messages, clients send and receive known _message types_ with "peers" - other clients, connected to the same channel and server.

 > Please see the [Peer-Events](https://github.com/bemson/subetha-client-pe) and [Ad Hoc-Exchange](https://github.com/bemson/subetha-client-ax) modules, for examples of how to define message types.


### Networking with SubEtha

The Client module manages the process of joining a SubEtha network. The first part establishes a secure connection to the Bridge module, which exists in an iframe. The second part involves the Bridge, authorizing clients to communicate with peers in a given channel (or, channel peers).

The secure connection and authorization process begins when you call the `#open()` method on a `Subetha.Client` instance. (This method can be called on new, existing, and already connected instances.)

```js
var client = new Subetha.Client();
client.open('as you wish@example.com/bridge.html');
```

The `#open()` method accepts an optional _network identifier_, formatted as "channel@server". While both parts of this identifier are optional and arbitrary, the "server" portion must be a url or _server alias_ that points to one. (Urls without a scheme become [scheme relative urls](https://url.spec.whatwg.org/#concept-scheme-relative-url).)

#### Monitoring client progress

Once a connection is established, a client authorization request on behalf of the client. As the authorization request is queued, sent, and awaiting a bridge response, the client's `.state`  property is updated by the Client module.

The `.state` property has five possible integer values. `3` indicates that the client connection is ready for use. You can observe changes to this property, by subscribing to the _::readyStateChange_ event. The event payload includes the current and previous connection states.

```js
client.on('::readyStateChange', function (curState, previousState) {
  if (curState == 0) {
    console.log('Back to 0... were we disconnected?');
  } else if (curState == 2) {
    console.log('Almost ready to talk!');
  }
  if (previousState == 3) {
    console.log('Just lost this connection!');
  }
});
```

##### Network events

Beyond state-change events, the Client module publishes several network events, that better communicate the connection status. All network events are prefixed with a double-colon (`::`), and are reserved for internal use only. Like subscribers to any Client event, callbacks are scoped to the client instance.

Below lists all Client network events. Payloads are also listed, where applicable.

  * **::auth-fail** - An authorization request fails.
    1. `reason`: _(number)_ A numeric code that best describes the error condition.
  * **::connect** - A connection is established.
    1. `peers`: _(object)_ The existing channel peers.
  * **::disconnect** - An established connection closed.
    1. `network`: _(string)_ The initially targeted network. This includes the _resolved_ server url with a valid scheme.
    2. `joined`: _(date)_ When the client connected to the network.
  * **::drop** - A peer leaves the channel.
    1. `peer`: _(Peer)_ The recently removed `Subetha.Peer` instance.
  * **::error** - A general, non-conforming network error occurred.
    1. `status`: _(number)_ A numeric code that best describes the error condition.
  * **::join** - A peer joins the channel.
    1. `peer`: _(Peer)_ The newly added `Subetha.Peer` instance.
    2. `exists` _(boolean)_ Flagged `true` if this peer connected to the network _before_ the client. Otherwise, `false`.
  * **::readyStateChange** - The `@state` property has changed. (This event precedes all other network events.)
    1. `newState`: _(number)_ The new state.
    2. `oldState`: _(number)_ The old state.

Network events are not preventable. However, the authorization request may be reversed and restarted at any time, using the`#close()` and `#open()` methods, respectively. Additionally, if an authorization request closes during a _::readyStateChange_ event, any subsequent network events will not occur.

```js
client
  .on('::readyStateChange', function (curState) {
    if (curState == 3) {
      console.log('Closing the just opened connection!');
      this.close();
    }
  })
  .on('::connect', function () {
    console.log('This never executes, because of the state-change handler!');
  });
```

> Invoking the `#open()` method on a connected/connecting client, closes the existing connection.

##### Error codes

There are no official error codes, presently. During this alpha phase of development, _::error_ events may or may not pass meaning arguments. Future releases should expand this section, to account for a variety of connection failures.

#### Tracking channel peers

Clients may access their channel peers, via the `.peers` property. When disconnected, this is an empty object. Upon authorizing a bridge connection, the `.peers` is prepopulated with existing peers (`Subetha.Peer` instances).

For security purposes, peers relay minimal information on themselves, or the host routine/page that created them. However, each peer instance is unique per client, allowing you to add custom properties that can only be shared along with the peer itself.

You can inspect peers that are already on your network via the _::connect_ event and the `Client.peers` object, or the _::join_ event.

```js
var person = new Subetha.Client();

person.open('party@public')
  .on('::connect', function () {
    var count = Object.keys(this.peers).length;
    console.log('%d partygoers are already here!', count);
  })
  .on('::join', function (peer, elder) {
    if (!elder) {
      console.log('Added %s to the party!', peer.id);
    }
  });
```

For both the _::join_ and _::drop_ network events, the peer passed in comes from the clients own `.peers` collection. This makes it easy for you to append custom members that are specific to your logic.

```js
var
  person = new Subetha.Client(),
  foundFirst;

person.open('pathfinders@public')
  .on('::join'. function (peer) {
    if (!foundFirst) {
      foundFirst = true;
      peer.first = true;
    }
  })
  .on('::drop', function (peer) {
    if (peer.first) {
      console.log('Sorry to see the first captured peer, go!');
    }
  });
```

#### Passing authorization credentials

Some bridges may require credentials during authorization. Credentials can be any valid value (or, set of values). Clients may add credentials to the instance, or specify them when opening a connection.

Below demonstrates two clients connecting to the same network. One sets network parameters and credentials manually, as instance members. The other does so automatically, via the `#open()` method.

```js
var
  manual = new Subetha.client(),
  auto = new Subetha.client();

// manually configure connection settings
manual.channel = 'do it';
manual.server = 'for.me';
manual.credentials = ['token', 1234];
// uses the instance properties
manual.open();

// automatically configure connection settings
auto.open('do it@for.me', 'token', 1234);
// the client properties are updated
console.log('%s / %s / [ %s ]', auto.channel, auto.server, auto.credentials);
// > do it / for.me / [ token,1234 ]
```

The `.credentials` member is used to authorize the client - except when `null` or `undefined`. Calling `#open()` with more than one argument, overwrites the `.credentials` property, with an array of the additional parameters. As with  all SubEtha messages, authorization values must must satisfy the [structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/Guide/API/DOM/The_structured_clone_algorithm).


### Messaging with SubEtha

Upon establishing a connection, you can exchange arbitrary messages over the SubEtha network. The Client module only works with messages with a _known type_. Otherwise, incoming messages are ignored, and outgoing messages fail. The message type informs where to route messages, and permits the Client to send them.

This constraint is designed to encourage a flat messaging hierarchy, such that any peer can send _or_ receive a given type of message. Skewed hierarchies, like [master/slave](https://en.wikipedia.org/wiki/Master/slave_(technology)), can then be layered on according to your needs. Specifically, it's recommended that **all peers use the same messaging logic and configuration**.

> The SubEtha module comes with two plugins that extend the core Client module: [Peer-Events](https://github.com/bemson/subetha-client-pe) and [Ad Hoc-Exchange](https://github.com/bemson/subetha-client-ax). Both modules define their own message types, then prototype methods for sending and processing their payloads.

#### Defining and handling message types

The Client module has no pre-defined message types. Instead, it implements routing logic that invokes handlers that match incoming message types. The `Subetha.types` object serves as the "registry" of message types, for all client instances. Each member's key is the _message type_; its associate function is the _message handler_. (The terms "type" and "handler" are often interchangeable.)

Below demonstrates adding a handler for the "acme/hug" message type. Once set, clients may also send this type of message to peers.

```js
Subetha.types['acme/hug'] = function (to, from) {
  console.log('%s received a hug from %s!', to.id, from.id);
};
```

Like any JavaScript object, the message type's member key may be any valid string. Namespacing is recommended, to avoid name collisions with other message types (e.g., "foobar/talk" is safer than "talk"). Moreover, library authors will likely prototype companion methods that send their particular message type; saving end-users from having to recall low-level, routing details.

> Clients are able to send message types _without_ a corresponding message handler. The `Subetha.types` object must still have a matching member key, but with any associate value - not just (handler) functions.

##### Message handler signature

The Client module will invoke handler functions, when an incoming message has: a matching message type, targets a connected client instance, and is sent by the client's peer. When invoked, message handlers should expect the following signature:

  1. `recipient`: _(Client)_ The client instance targeted by this message.
  2. `sender`: _(Peer)_ The peer that sent the message.
  3. `payload`: (mixed) The value, if any, sent with this message.
  4. `details`: (object) Additional information about the message.
    - `mid`: (string) The message identifier.
    - `sent`: (date) When this message was sent (by the peer).
    - `received`: (date) When this message was received (by the Client module).
    - `broadcast`: (boolean) Indicates when this message was broadcast to the channel or specific peers.
    - `recipients`: (number) The number of peers expected to recieve this message.

#### Sending messages

The Client module only sends message types that have a matching key in the `Subetha.types` object. (Unlike handling incoming messages, the associate value does _not_ have to be a function.) Use the `#_transmit()` method to send _known_ message types, to one or more recipients, with an optional payload.

[Private-by-convention](https://developer.mozilla.org/en-US/Add-ons/SDK/Guides/Contributor_s_Guide/Private_Properties#Using_Prefixes), this method is not intended for direct use. Instead, library authors are **strongly advised to send messages with custom methods**. This should reduce end-user boilerplate, encapsulate low-level routing details, and permit validating message contents.

Below demonstrates a custom method that inspects its instance before sending a "acme/hug" message type.

```js
Subetha.Client.prototype.hug = function () {
  var client = this;
  // if we're not alone...
  if (Object.keys(client.peers).length) {
    // hug everyone
    client._transmit('acme/hug');
  }
};
```

##### Targeting recipients & blocking peers

The Client module broadcasts messages, unless given a list of recipients. Any unblocked peer, can be a recipient. Once connected, the client's `@peers` object represents them as `Subetha.Peer` instances.

To target a specific peer, pass a reference to the `#_transmit()` method - i.e., the peer instance or string identifier. Peers are considered blocked, or invalid, if their id and instance are _not_ in the `@peers` object. Clients can not target blocked/invalid peers as message recipients.

The example below configures a message type and method that messages and blocks peers that send a particular message.

```js
Subetha.types['library/shout'] = function (recipient, sender) {
  // send "scold" message to noisy peer
  recipient.scold(sender).then(function () {
    // block peer, by removing from @peers object
    delete recipient.peers[sender.id];
  })
};

// message a particular recipient
Subetha.Client.prototype.scold = function (who) {
  return this._transmit('library/scold', null, who);
};
```

 > Presently, broadcast messages _are_ sent to blocked peers. However (and in all cases), if the recipient blocks the sender, the message is not recieved.

##### Promises

The `#_transmit()` method returns a [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) that resolves when the bridge confirms relaying the message, on the SubEtha network. That is, the promise is fulfilled _before_ recipients receive the message.

There are many failure conditions that would reject the returned promise. For example, targeting blocked/invalid recipients, or sending an unknown message type. The rejected promise passes the reason as an [Error](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error) instance.

 > Library authors are encouraged to pass the returned _thenable_ to end-users, or a promise dependent on it.


## API

This section serves as reference documentation to using the SubEtha-Client module. The Client module exports a `Subetha` namespace and several classes.

Instance methods are prefixed with a pound-symbol (`#`). Instance properties are prefixed with an at-symbol (`@`). Static members (both properties and methods) are prefixed with a double-colon (`::`).

> While much of the secure connection and authorization logic is managed internally, library authors are encouraged to extend the exposed constructors and customize their prototypes.



### Subetha::Client

Construct a new Client instance.

```
var client = new Subetha.Client();
```

Client inherits from Events (`Subetha.Events`).

This class is **meant for direct instantiation**.

#### Client#close()

Close the current connection.

```
client.close();
```

Returns the client instance.

#### Client#open()

Begin connecting to a server and channel.

```
client.open([network [, credentials, ... ]);
```

  * **network**: _(string)_ A string using the format "channel@server".
  * **credentials**: (_mix_) Additional values, to be sent while authorizing this client.

Returns the client instance.

This method will close any open or opening network connection. This behavior may trigger a _::disconnect_ event (from closing the previous connection).

When given, the parsed portions of the _network_ parameter (i.e., before and/or after the "@" symbol), will be captured in the `@channel` and/or `@server` properties, respectively.

Additional arguments are captured in a new `@credentials`  array.

#### Client#_transmit()

Send a message to all or some channel peers.

```
client._transmit(type [, data [, peers]]);
```

   * **type**: _(string)_ An arbitrary message type.
   * **data**: _(mix)_ An arbitrary message value.
   * **peers**: _(falsy|peer[])_ One or more peers that should receive this message. A falsy value broadcasts the message to all channel peers.

Returns a Promise.

The Promise is fulfilled when the Bridge has published this message on the network. However, a fulfilled promise does _not_ mean the message was receieved by any of the target recipients.

The Promise is rejected under any of these conditions:

  - The client is not connected to the network.
  - The given message type is invalid (has no corresponding key in the `Subetha.types` object).
  - The given _peers_ parameter is an empty array.
  - One or more target recipients are not channel peers.
  - The sending Client has no message handler for the given _type_ parameter.
  - The Client disconnects before the Bridge responds.
  - The _data_ parameter fails the [structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/Guide/API/DOM/The_structured_clone_algorithm).

Valid values for the _peers_ parameter are the peer identifier (string or number), and Peer instances. Only peers of the client may be targeted.

**Note:** This method is [protected-by-convention](https://developer.mozilla.org/en-US/Add-ons/SDK/Guides/Contributor_s_Guide/Private_Properties#Using_Prefixes), and is intended for use by library authors, only.

#### Client@channel

The channel name used to establish a connection.

```
client.channel;
```

The default (prototyped) value is "lobby".

This property should only be changed when disconnected. Changing this value has no effect on connected clients.

This property is used when calling the `#open()` method with no arguments. Alternately, the value is updated when that method is passed a valid _network_ parameter.

#### Client@credentials

One or more values used to authorize a connection.

```
client.credentials;
```

This property is used when calling the `#open()` method with less than two arguments. Alternately, the value is updated when that method is passed more than one parameter.

This value is converted to an array before transmission. A value of `null` or `undefined` is ignored. The value(s) must support the [structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/Guide/API/DOM/The_structured_clone_algorithm).

#### Client@id

The unique identifier of this client in the network.

```
client.id;
```

The value is `0` when not connected to a network (Bridge), and updated with a unique identifier when a connection is established. Though it should be considered a read-only property, changing the value has no impact on the connnection state.

#### Client@state

A number, reflecting the client connection status.

```
client.state;
```

There are five possible client states:

  * `0` (_initial_): No connection.
  * `1` (_queued_): A new authorization request has been queued.
  * `2` (_pending_): The authorization request is sent.
  * `3` (_ready_): A connection is established.
  * `4` (_closing_): The connection is closing.

This property is managed with internal logic. Value/State changes are broadcast via the _::readyStateChange_ event. This property should be considered read-only, as direct manipulation has no impact on the connnection state.

#### Client@server

The Bridge url (or alias) used to establish a connection.

```
client.server;
```

The default (prototyped) value is "local", a server alias.

This property should only be changed when disconnected. Changing this value has no effect on connected clients.

This property is used when calling the `#open()` method with no arguments. Alternately, the value is updated when that method is passed a valid _network_ parameter, where the _server_ portion follows an "@" symbol.

This string value is considered a server alias, if it's value matches a key in the `Subetha.servers` namespace. The aliased value is then used, instead of the alias, as the source of the iframe (i.e., the Bridge).

### Subetha::Events

Construct a new Events instance.

```
var eventer = new Subetha.Events();
```

This class is **not meant for direct instantiation.** The constructor and prototype are exposed for convenience. Excluding chainability, in order to interoperate with internal routines, any prototypal changes must support the existing API.

#### Events#fire()

Trigger callbacks, subscribed to an event.

```
eventer.fire(event [, args, ... ]);
```

   * **event**: _(string)_ The event to trigger.
   * **args**: _(mix)_ Remaining arguments that pass-thru to subscribed callbacks.

Returns this instance.

#### Events#on()

Subscribe to an event.

```
eventer.on(event, callback);
```

   * **event**: _(string)_ An arbitrary event name.
   * **callback**: _(function)_ A callback to invoke.

Returns this instance.

#### Events#off()

Unsubscribe from an event.

```
eventer.off([event [, callback]]);
```

   * **event**: _(string)_ An arbitrary event.
   * **callback**: _(function)_ The callback to detach.

Returns this instance.

When called without arguments, all subscriptions are removed. When called with an event but no callback, all callbacks of the event are removed.

### Subetha::Peer

Construct a new Peer instance.

```
var peer = Subetha.Peer(cfg, client);
```

  * **cfg**: _(object)_ Configuration for this instance.
  * **client**: _(Client)_ Client instance that references this peer.

This class is **not meant for direct instantiation**. The constructor and prototype are exposed for convenience and augmentation, by library authors only.

Peers are unique per client, encouraging the practical addition of instance members. However, documented members should be considered read-only. Whereupon changes may result in the removal of the corresponding Client.

#### Peer@channel

The name of the channel containing this peer.

```
peer.channel;
```

#### Peer@id

The unique identifier of this peer in the network.

```
peer.id;
```

#### Peer@origin

The location origin of the web context that created this peer.

```
peer.origin;
```

This value is derived from, or calculated as, the [location.origin](https://developer.mozilla.org/en-US/docs/Web/API/URLUtils/origin).

#### Peer@start

A `Date` instance, reflecting when the peer joined the network.

```
peer.start;
```

#### Peer@state

A number, reflecting the peer connection status.

```
peer.state;
```

The two peer states possible, are a sub-set of the client connection states:

  * `0` (_initial_): No connection.
  * `3` (_ready_): A connection is established.

### Subetha::bridgeTimeout

The delay allowed before aborting the connection process.

```
Subetha.bridgeTimeout;
```

The default value is `10000` milliseconds (or 10 seconds). This default is employed when the property is set to an invalid number (i.e., non-numeric or negative).

The timeout period is observed from when the iframe is added to the document, until the Bridge establishes a connection. Should the timeout expire, the connection process is aborts: the iframe is removed, and all queued Client connections dispatch an _::error_ event.

### Subetha::types

Collection of message handlers.

```
Subetha.types;
```

This property is an empty object (`{}`), by default. Keys on this object, determine what messages may be sent (via the `#_transmit()` method) and received. This object is intended for use by library authors.

Member functions of this object are called "message handlers". The Client module invokes handlers when an incoming message matches the message type (or, member key).

Message handlers should expect the following signature:

  1. _receiver_ - The client that received this message.
  2. _sender_ - The peer instance, representing whom sent the message.
  3. _payload_ - Any custom value, sent with the type.
  4. _details_ - Information on how the message was configured and transported.
    * `mid` - An identifier of this message, unique to the network.
    * `sent` - A `Date` instance, indicating when the message was sent.
    * `received` - A `Date` instance, indicating when the message was received.
    * `broadcast` - A boolean that is `true`, when the message targets all channel peers.
    * `recipients` - The number of expected recipients.

### Subetha::protocol

The name and version of the SubEtha protocol, implemented by this Client module.

```
Subetha.protocol;
```

### Subetha::servers

Collection of server aliases.

```
Subetha.servers;
```

Keys of this object may be used as the _server_ portion of a network identifier ("channel@server"). Upon starting the connection process, it's associate url will be used to load a specific Bridge module.

By default, the Client module comes with two server aliases: local and public. The "local" alias is a JavaScript url, that loads a hosted copy of the Bridge module, useful for same-domain messaging. The "public" alias points to a CDN hosted web page, that loads the Bridge module, useful for cross-domain messaging.

### Subetha::version

The [SemVer](http://semver.org) compatible version of this Client module.

```
Subetha.version;
```


## Installation

SubEtha-Client works within, and is intended for, modern JavaScript browsers. It is available on [bower](http://bower.io/search/?q=subetha-client), [component](http://component.github.io/) and [npm](https://www.npmjs.org/package/subetha-client) as a [CommonJS](http://wiki.commonjs.org/wiki/CommonJS) or [AMD](http://wiki.commonjs.org/wiki/Modules/AsynchronousDefinition) module.

If a SubEtha-Client isn't compatible with your favorite runtime, please file an issue or pull-request (preferred).

### Feature dependencies

SubEtha-Client uses the following ECMAScript 5 & 6, and HTML 5 features:

  * [postMessage](http://caniuse.com/#search=postMessage)
  * [Promise](http://caniuse.com/#search=promises)
  * [MessageChannel](http://caniuse.com/#search=messagechannel)

 > For [runtimes that don't support Promises](http://caniuse.com/#search=promise) (mainly IE), the `#_transmit()` method returns a _mock_ thenable object. Any [conformant Promise polyfills](https://promisesaplus.com/implementations) must load _before_ the Client module.

### Web browsers

Use a `<SCRIPT>` tag to load the _subetha-client.min.js_ file in your web page. Doing so, adds `Subetha` to the global scope.

```html
  <script src="path/to/subetha-client.min.js"></script>
  <script>
    // ... SubEtha dependent code ...
  </script>
```

**Note:** The minified file was compressed by [Closure Compiler](http://closure-compiler.appspot.com/).

### Package managers

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

**Note:** Prefer AMD optimizers, like [r.js](https://github.com/jrburke/r.js/), over minified files.


## License

SubEtha is available under the terms of the [Apache-License](http://www.apache.org/licenses/LICENSE-2.0.html).

Copyright 2015, Bemi Faison
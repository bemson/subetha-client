var
  mockDoc,
  chai = require('chai'),
  sinonChai = require('sinon-chai')
;

console.log('has promise? ', typeof Promise == 'function');

chai.use(sinonChai);
chai.should();

Node.prototype = {
  _all: function () {
    var kids = this._kids;
    return kids.concat.apply(0, kids.map(function (kid) {
      return kid._all();
    }));
  },
  createElement: function (name) {
    return new Node(name);
  },
  contains: function (el) {
    return ~this._all().indexOf(el);
  },
  removeChild: function (child) {
    var
      kids = this._kids,
      idx = kids.indexOf(child)
    ;
    if (~kids.indexOf(child)) {
      kids.splice(idx,1);
      return child;
    }
  },
  appendChild: function (child) {
    var node = this;

    node.removeChild(child);
    node._kids.push(child);
    return child;
  },
  setAttribute: function (name, value) {
    this[name] = value;
  },
  getAttribute: function (name) {
    var node;
    if (node.hasAttribute(name)) {
      return node[name];
    }
    return null;
  },
  hasAttribute: function (name) {
    return this.hasOwnProperty(name);
  },
  removeAttribute: function (name) {
    delete this[name];
  }
};

mockDoc = new Node();
mockDoc.location = {protocol:'http:'};

global.document = mockDoc;
global.Subetha = require('../src/subetha-client');
global.sinon = require('sinon');
global.expect = chai.expect;

function Node() {
  var node = this;

  node.style = {};
  node._kids = [];
}
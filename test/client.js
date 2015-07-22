describe( 'SubEtha', function () {

  it( 'should be a versioned namespace', function () {
    Subetha.should.be.an('object');
    Subetha.version
      .should.be.a('string')
      .and.match(/^\d+\.\d+\.\d+/);
  });

  describe('Client', function () {

    it( 'should be a constructor, expecting zero arguments', function () {
      expect(Subetha.Client)
        .to.be.a('function')
        .and.have.lengthOf(0);

      expect(new Subetha.Client()).to.be.an.instanceOf(Subetha.Client);
    });

    describe('#_transmit()', function () {

      if (typeof Promise == 'function') {
        describe ('with Promises', function () {

          it('should return a thenable', function () {

            var x = new Subetha.Client();
            expect(x._transmit())
              .to.be.a('object')
              .and.itself.to.respondTo('then')
              .and.itself.to.respondTo('catch');

          });

          describe('when disconnected', function () {

            it('should reject calls', function (done) {

              var x = new Subetha.Client();
              x._transmit()['catch'](function () {
                // passing the error to done, fails the test
                done();
              });

            });

          });

        });

      } else {

        describe('without Promises', function () {

          it('should return a mock thenable', function () {

              var x = new Subetha.Client();
              x._transmit().then.should.equal(x._transmit().then);

          });

        });

      }


    });

  });

});
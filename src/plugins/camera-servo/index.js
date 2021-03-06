(function() 
{
    const ArduinoHelper = require('ArduinoHelper')();
    const Periodic = require( 'Periodic' );
    const Listener = require( 'Listener' );

    // Encoding helper functions
    function encode( floatIn )
    {
        return parseInt( floatIn * 1000 );
    }

    function decode( intIn )
    {
        return ( intIn * 0.001 );
    }

    class CameraServo
    {
        constructor(name, deps)
        {
            deps.logger.debug( 'CameraServo plugin loaded' );

            this.globalBus  = deps.globalEventLoop;
            this.cockpitBus = deps.cockpit;

            this.targetPos          = 0;
            this.targetPos_enc      = 0;
            this.mcuTargetPos_enc   = 0;

            this.settings           = {};
            this.encodedSettings    = {};   // Used to work around floating point settings
            this.mcuSettings        = {};

            var self = this;

            this.SyncSettings = new Periodic( 1000, "timeout", function()
            {
                var synced = true;

                // TODO: These should be used at compile time in autogenerated MCU constructors
                // Check latest values from MCU against plugin's desired settings

                // Inversion
                if( self.mcuSettings.inverted !== self.settings.inverted )
                {
                    synced = false;
                    // disable transmission of unused commands
                    // Send inversion setting request to the MCU
                    // var command = 'camServ_inv(' + ( self.settings.inverted ? 1 : 0 ) + ')';
                    // self.globalBus.emit( 'mcu.SendCommand', command );
                }

                // Servo speed
                if( self.mcuSettings.speed !== self.encodedSettings.speed )
                {
                    synced = false;

                    // disable transmission of unused commands
                    // Send speed setting request to the MCU
                    // var command = 'camServ_spd(' + self.encodedSettings.speed + ')';
                    // self.globalBus.emit( 'mcu.SendCommand', command );
                }

                if( synced )
                {
                    // No need to continue
                    self.SyncSettings.stop();

                    // Enable API now that the MCU settings are updated
                    self.listeners.setTargetPos.enable();
                }
            });

            this.SyncTargetPosition = new Periodic( 33, "timeout", function()
            {
                var synced = true;

                // Send target position to MCU until it responds with affirmation
                if( self.mcuTargetPos_enc !== self.targetPos_enc )
                {
                    synced = false;

                    // disable transmission of unused commands
                    // Encode floating point position to integer representation
                    // var command = 'camServ_tpos(' + self.targetPos_enc + ')';

                    // Emit command to mcu
                    // self.globalBus.emit( 'mcu.SendCommand', command );
                }

                if( synced )
                {
                    // No need to continue
                    self.SyncTargetPosition.stop();
                }
            });

            this.listeners = 
            {
                settings: new Listener( this.globalBus, 'settings-change.cameraServo', true, function( settings )
                {
                    // Disable API until MCU sync achieved
                    self.listeners.setTargetPos.disable();

                    // Apply settings
                    self.settings = settings.cameraServo;

                    // Store encoded settings
                    self.encodedSettings.speed = encode( self.settings.speed );

                    // Enable MCU Status listener, if not already enabled
                    self.listeners.mcuStatus.enable();
                    
                    // Emit settings update to cockpit
                    self.cockpitBus.emit( 'plugin.cameraServo.settingsChange', self.settings );

                    // Update the targetPos in case the ranges changed and it needs re-limiting
                    self.setTargetPos( self.targetPos );

                    // Initiate a sync of the settings with the MCU
                    self.SyncSettings.start();
                }),

                mcuStatus: new Listener( this.globalBus, 'mcu.status', false, function( data )
                {
                    // Servo inversion
                    if( 'camServ_inv' in data )
                    {
                        self.mcuSettings.inverted = ( parseInt( data.camServ_inv ) == 1 ? true : false );
                    }

                    // Servo speed
                    if( 'camServ_spd' in data )
                    {
                        self.mcuSettings.speed = parseInt( data.camServ_spd );
                    }

                    // Servo position
                    if( 'camServ_pos' in data ) 
                    {
                        // Convert from integer to float
                        var angle = decode( parseInt( data.camServ_pos ) );

                        // Emit on cockpit bus for UI purposes
                        self.cockpitBus.emit( 'plugin.cameraServo.currentPos', angle );
                    }

                    // Servo target position
                    if( 'camServ_tpos' in data ) 
                    {
                        // Save encoded version for sync validation purposes
                        self.mcuTargetPos_enc = parseInt( data.camServ_tpos );

                        // Convert from integer to float
                        var angle = decode( self.mcuTargetPos_enc );

                        // Emit the real target position on the cockpit bus for UI purposes
                        self.cockpitBus.emit( 'plugin.cameraServo.targetPos', angle );
                    }
                }),

                setTargetPos: new Listener( this.cockpitBus, 'plugin.cameraServo.setTargetPos', false, function( posIn )
                {
                    // Validate inputs
                    var pos = parseInt( posIn );

                    if( !isNaN( pos ) )
                    {
                        // Set new target position
                        self.setTargetPos( pos );
                    }
                })
            }
        }

        setTargetPos( posIn )
        {
            var self = this;

            // Apply position limits based on servo's range
            if( posIn > self.settings.rangeMax )
            {
                self.targetPos = self.settings.rangeMax;
            }
            else if( posIn < self.settings.rangeMin )
            {
                self.targetPos = self.settings.rangeMin;
            }
            else
            {
                self.targetPos = posIn;
            }

            self.targetPos_enc = encode( self.targetPos );

            // Start targetPos sync, if not already running
            self.SyncTargetPosition.start();
        }
        
        start()
        {
            this.listeners.settings.enable();
        }

        stop()
        {
            this.listeners.settings.disable();
            this.listeners.mcuStatus.disable();
            this.listeners.setTargetPos.disable();
        }

        getSettingSchema()
        {
            //from http://json-schema.org/examples.html
            return [{
                'title': 'Camera Servo',
                'type': 'object',
                'id': 'cameraServo',
                'category': 'general',
                'managedBy': 'nobody',
                'properties': {
                    'speed': {
                        'title': 'Servo Speed (deg/s)',
                        'type': 'number',
                        'default': 45.0
                    },
                    'controlSensitivity': {
                        'title': 'Control Sensitivity (multiplier)',
                        'type': 'number',
                        'default': 1.0
                    },
                    'rangeMax': {
                        'title': 'Max Angle (deg)',
                        'type': 'number',
                        'default': 32.8
                    },
                    'rangeMin': {
                        'title': 'Min Angle (deg)',
                        'type': 'number',
                        'default': -40.6
                    },
                    'stepResolution': {
                        'title': 'Step Resolution (deg/step)',
                        'type': 'number',
                        'default': 10.0
                    },
                    'inverted': {
                        'title': 'Inverted',
                        'type': 'boolean',
                        'format': 'checkbox',
                        'default': false
                    }  
                },

                // TODO: Need to classify which settings are used at various levels: MCU Model, Local Model, UI model
                'required': [
                    'speed',                // Max speed of servo
                    'controlSensitivity',   // When doing joystick or buttonHeld controls, multiplier against servo speed for moving the targetPos
                    'rangeMax',             // Furthest position in positive direction
                    'rangeMin',             // Furthest position in negative direction
                    'stepResolution',       // (UI)
                    'inverted'              // (MCU) Used when remapping angle inputs to microseconds. Unrelated to min and max range
                ]
            }];
        }
    }


    module.exports = function(name, deps) 
    {
        if( process.env.PRODUCTID == "trident" )
        {
            deps.logger.debug( "Camera Servo Not supported on trident" );
            return {};
        }

        return new CameraServo(name, deps);
    };
}());

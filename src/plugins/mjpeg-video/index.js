(function() 
{
    const fs        = require('fs');
    const respawn   = require('respawn');
    const util      = require('util');
    const io        = require('socket.io-client');
    const assert    = require('assert');
    const Listener  = require( 'Listener' );

    var logger;
    var defaults = 
    {
        port: 8090,
        wspath: '/mjpeg'
    };

    class MjpgStreamer
    {
        constructor( name, deps )
        {
            logger = deps.logger;
            
            logger.info( "Loaded Cockpit Plugin: MjpgStreamer" );

            this.globalBus  = deps.globalEventLoop;
            this.cockpitBus = deps.cockpit;

            this.runVideo0  = false;
            this.runVideo1  = false;
            this.settings   = {};
            this.supervisor = {};
            this.camera     = null;
            this.disabled   = false;

            this.supervisorLaunchOptions = 
            [
                "nice",
                "-1",
                "node",
                require.resolve( 'mjpeg-video-server' ),
                "-p",
                defaults.port
            ];
//                "-c",
//                "/etc/openrov/STAR_openrov_net.chained.crt",
//                "-k",
//                "/etc/openrov/star_openrov_net.key"

            // Handle mock options
            if( process.env.USE_MOCK === 'true' ) 
            {
                if( process.env.MOCK_VIDEO_TYPE === "MJPEG" )
                {
                    logger.info( "Using MJPEG video format in Mock Mode.");

                    this.supervisorLaunchOptions.push( '-m' );
                    this.supervisorLaunchOptions.push( 'true' );

                    if( process.env.MOCK_VIDEO_HARDWARE === 'false' )
                    {
                        logger.info( "Using actual MJPEG video source.");

                        this.supervisorLaunchOptions.push( '-h' );
                        this.supervisorLaunchOptions.push( 'true' );
                    }
                    else
                    {
                        logger.info( "Using mocked MJPEG video source.");
                    }
                }
                else
                {
                    this.disabled = true;
                    return;
                }
            }

            this.supervisor = io.connect( 'http://localhost:' + defaults.port,
            {
                path: defaults.wspath,
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000
            });

            this.svMonitor = respawn( this.supervisorLaunchOptions, 
            {
                name: 'mjpeg-video-server',
                env: 
                {
                    'COCKPIT_PATH': process.env[ "COCKPIT_PATH" ],
                    'DEBUG': 'app*'
                },
                maxRestarts: -1,
                sleep: 1000
            });
            logger.info("this.svMonitor: ", this.svMonitor);

            this.svMonitor.on( "stdout", (data) =>
            {
                logger.debug( data.toString() );
            });

            this.svMonitor.on( "stderr", (data) =>
            {
                logger.debug( data.toString() );
            });      

            // Set up listeners
            this.listeners = 
            {
                settings: new Listener( this.globalBus, 'settings-change.mjpegVideo', true, (settings) =>
                {
                    try
                    {
                        // Check for settings changes
                        assert.notDeepEqual( settings.mjpegVideo, this.settings );

                        // Update settings
                        this.settings = settings.mjpegVideo;

                        logger.info( `Updating MJPEG streamer settings to: \n${this.settings}` );

                        // Send update to supervisor so it restarts the stream
                        this.supervisor.emit( "updateSettings", this.settings );
                    }
                    catch( err )
                    {
                        // Do nothing
                    }
                }),

                scanForCameras: new Listener( this.cockpitBus, "plugin.mjpegVideo.scanForCameras", false, function(runVideo0, runVideo1)
                {
                    logger.info( "Scanning: ", this.supervisor );
                    if (this.supervisor === undefined) return;
                    this.runVideo0 = runVideo0;
                    this.runVideo1 = runVideo1;
                    this.supervisor.emit( "scan", this.runVideo0, this.runVideo1 );
                }),

                svConnect: new Listener( this.supervisor, 'connect', false, () =>
                {
                    logger.info( 'Successfully connected to mjpg-streamer supervisor ', this.supervisor );

                    // Start listening for settings changes (gets the latest settings)
                    this.listeners.settings.enable();
                }),

                svDisconnect: new Listener( this.supervisor, 'disconnect', false, function()
                {
                    logger.info( 'Disconnected from mjpg-streamer supervisor' );
                }),

                svError: new Listener( this.supervisor, 'error', false, function(err)
                {
                    logger.error(err, 'Mjpg-streamer supervisor connection error' );
                }),

                svReconnect: new Listener( this.supervisor, 'reconnect', false, function()
                {
                    logger.info('Reconnecting to mjpg-streamer supervisor...');
                }),

                svStreamRegistration: new Listener( this.supervisor, 'stream.registration', false, ( serial, info ) =>
                {
                    logger.info('Stream Registration: ' + JSON.stringify(info) );
                    var relativeServiceUrl = null;
                    if (info.relativeServiceUrl !== null) {
                       relativeServiceUrl = info.relativeServiceUrl;
                    } else {
                       relativeServiceUrl = `:${info.port}`;
                    }

                    this.globalBus.emit( 'CameraRegistration', 
                    {
                        location:           "forward",               // TODO: Lookup location based on serial ID
                        videoMimeType: 	    "video/x-motion-jpeg",
                        resolution:         info.resolution,
                        framerate:          info.framerate, 
                        wspath:             "",
                        relativeServiceUrl: relativeServiceUrl,
                        sourcePort:         info.port,
                        sourceAddress:      "",
                        connectionType:     info.connectionType,
                        cameraName:         info.cameraName,
                        cameraID:           info.cameraID
                    });
                })
            }
        }

        start()
        {
            logger.info("start mjpg-streamer supervisor: ", this.disabled);
            if( this.disabled )
            {
                return;
            }

            // Enable listeners
            this.listeners.svConnect.enable();
            this.listeners.svDisconnect.enable();
            this.listeners.svError.enable();
            this.listeners.svReconnect.enable();
            this.listeners.svStreamRegistration.enable();

            this.listeners.scanForCameras.enable();

            // Start the supervisor process
            this.svMonitor.start();
        }

        stop()
        {
            logger.info("stop mjpg-streamer supervisor: ", this.disabled);
            if( this.disabled )
            {
                return;
            }
            
            // Stop the supervisor process
            this.svMonitor.stop();

            // Disable all listeners
            for( var listener in this.listeners ) 
            {
                if( this.listeners.hasOwnProperty( listener ) ) 
                {
                    listener.disable();
                }
            }
        }

        getSettingSchema()
        {
            return [
            {
                'title':    'MJPEG Video',
                'type':     'object',
                'id':       'mjpegVideo',
                'category' : 'video',

                'properties': {
                    'framerate': 
                    {
                        'type': 'string',
                        'enum': 
                        [
                            '30',
                            '15',
                            '10'
                        ],
                        'title': 'Framerate (FPS)',
                        'default': '10'
                    },
                    'resolution': 
                    {
                        'type': 'string',
                        'enum': 
                        [
                            '1920x1080',
                            '1280x720',
                            '800x600',
                            '640x480',
                            '352x288',
                            '320x240',
                            '176x144',
                            '160x120'
                        ],
                        'title': 'Resolution',
                        'default': '800x600'
                    }                    
                },

                'required': 
                [
                    'framerate',    // Framerate setting for camera
                    'resolution'    // Resolution setting for camera
                ]
            }];
        }
    }

    module.exports = function( name, deps ) 
    {
        if( process.env.PRODUCTID == "trident" )
        {
            deps.logger.info( "MjpgStreamer Not supported on trident" );
            return {};
        }
        deps.logger.info("new mjpg-streamer supervisor");

        return new MjpgStreamer( name, deps );
    };
}());

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const modesl = require('modesl');
const winston = require('winston');
require('winston-daily-rotate-file');
require('dotenv').config();

const appName = "ContactCentre Switch";

const port = process.env.APP_PORT || 3001;
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [],
    }
});

const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.printf(info => `${info.message}\n`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
            filename: 'logs/%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles: '14d',
        })
    ]
});

try {
    const connection = new modesl.Connection(process.env.ESL_HOST, process.env.ESL_PORT, process.env.ESL_PASSWORD, function() {
        logger.info('Connected to FreeSWITCH ESL.');
    });

    connection.on("error", (error) => {
        logger.error("An error occured while trying to connect to FreeSWITCH: ", error);
        logger.info(`${ appName } will now exit.`);    
    });

    connection.on('end', () => {
        logger.info('Connection to FreeSWITCH ESL closed.');    
    });

    connection.on('ready', () => {
        logger.info('Connected to FreeSWITCH ESL.');

        connection.api('sofia xmlstatus', function(res) {
            // Process the response, which is in XML format
            console.log(res.getBody());
        });
    
        // Global ESL events subscription (events clients can subscribe to)
        const subscriptions = process.env.EVENTS_TO_SUBSCRIBE ? process.env.EVENTS_TO_SUBSCRIBE.split(',') : [];
        connection.subscribe(subscriptions, () => {
            logger.info(`Server subscribed to events: ${ subscriptions.join(', ') }`);
        });
        
        // Middleware to parse JSON body
        app.use(express.json());
        
        // REST endpoint for sending commands to FreeSWITCH
        app.post('/send-command', (req, res) => {
            const command = req.body.command;
        
            connection.api(command, (response) => {
                res.json({ result: response.getBody() });
            });
        });
        
        // Handle client connections
        io.on('connection', (socket) => {
            logger.info('Client connected.');
        
            for (const subscription of subscriptions) {
                // Handle ESL events and send to subscribed clients
                connection.on(subscription, (event) => {
                    const eventName = event.getHeader('Event-Name');
                    io.emit('freeswitch-event', { 
                        name: eventName, 
                        data: event.serialize() 
                    });
                });
            }
        
            socket.on('disconnect', () => {
                logger.info('Client disconnected.');
            });
        });
    });    
 
    server.listen(port, () => {
        logger.info(`${ appName } running on port ${ port }.`);
    });
} catch (error) {
    logger.error("An error occured", error);    

    process.exit(1);
}
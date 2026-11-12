const server = require('./game-server');
const port = Number(process.env.PORT || 3000);

server.listen(port, '0.0.0.0', () => console.log(`Countdown Club listening on ${port}`));

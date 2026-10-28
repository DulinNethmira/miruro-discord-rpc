const { spawn } = require('child_process');
const path = require('path');

const dir = path.resolve(__dirname);
const proc = spawn('node', ['bridge.js'], {
  cwd: dir,
  detached: true,
  stdio: 'ignore'
});

proc.unref();
console.log('Detached bridge started with PID:', proc.pid);
process.exit(0);

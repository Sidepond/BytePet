const fs = require('node:fs');
const path = require('node:path');
const { isPosition } = require('./window.cjs');

function createPositionStore(directory, warn = console.warn) {
  const file = path.join(directory, 'pet-position.json');
  return {
    read() {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        return saved?.version === 1 && isPosition(saved) ? { x: saved.x, y: saved.y } : null;
      } catch (error) {
        if (error.code !== 'ENOENT') warn('Could not read BytePet position:', error.message);
        return null;
      }
    },
    write(position) {
      if (!isPosition(position)) return false;
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(temporary, JSON.stringify({ version: 1, x: position.x, y: position.y }) + '\n', { mode: 0o600 });
        fs.renameSync(temporary, file);
        return true;
      } catch (error) {
        warn('Could not save BytePet position:', error.message);
        try { fs.unlinkSync(temporary); } catch { /* Nothing to clean up. */ }
        return false;
      }
    },
  };
}

module.exports = { createPositionStore };

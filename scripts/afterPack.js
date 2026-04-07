const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  const { appOutDir, packager } = context;
  
  // For Linux builds
  if (process.platform === 'linux') {
    const wrapperScript = path.join(appOutDir, 'bin', 'openpod-tagger-wrapper');
    const realExecutable = path.join(appOutDir, 'openpod-tagger');
    const wrapperDest = path.join(appOutDir, 'openpod-tagger-wrapper');
    
    // Copy wrapper script to app directory
    if (fs.existsSync(wrapperScript)) {
      fs.copyFileSync(wrapperScript, wrapperDest);
      fs.chmodSync(wrapperDest, 0o755);
      
      // Replace the main executable with the wrapper (or rename)
      // Option 1: Rename original and use wrapper as main
      if (fs.existsSync(realExecutable)) {
        fs.renameSync(realExecutable, path.join(appOutDir, 'openpod-tagger-real'));
        fs.copyFileSync(wrapperDest, realExecutable);
        fs.chmodSync(realExecutable, 0o755);
      }
    }
  }
};

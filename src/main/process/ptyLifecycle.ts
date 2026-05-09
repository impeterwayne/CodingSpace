function killPtyProcess(proc, execSync) {
  try {
    const pid = proc.pid;
    proc.kill();
    if (process.platform === 'win32' && pid) {
      try {
        execSync(`taskkill /pid ${pid} /T /F`, {
          stdio: 'ignore',
          timeout: 5000,
        });
      } catch (_) {}
    }
  } catch (_) {}
}

function installPtyShutdownLifecycle(app, ptyProcesses, execSync) {
  function killAllPtyProcesses() {
    for (const [, proc] of ptyProcesses) {
      killPtyProcess(proc, execSync);
    }
    ptyProcesses.clear();
  }

  app.on('before-quit', () => {
    killAllPtyProcesses();
  });

  app.on('window-all-closed', () => {
    killAllPtyProcesses();
    app.quit();
  });
}

module.exports = {
  installPtyShutdownLifecycle,
  killPtyProcess,
};

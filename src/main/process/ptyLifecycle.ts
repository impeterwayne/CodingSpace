function installPtyShutdownLifecycle(app, ptyProcesses, execSync) {
  function killAllPtyProcesses() {
    for (const [id, proc] of ptyProcesses) {
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
};

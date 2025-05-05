local docker_image = 'registry.oxen.rocks/debian-stable';

local apt_get_quiet = 'apt-get -o=Dpkg::Use-Pty=0 -q';

[
  {
    kind: 'pipeline',
    type: 'docker',
    name: 'Linux (amd64)',
    platform: { arch: 'amd64' },
    steps: [
      {
        name: 'build',
        image: docker_image,
        environment: {
          SSH_KEY: { from_secret: 'SSH_KEY' },
        },
        commands: [
          'echo "Building on ${DRONE_STAGE_MACHINE}"',
          'echo "man-db man-db/auto-update boolean false" | debconf-set-selections',
          apt_get_quiet + ' update',
          apt_get_quiet + ' install -y eatmydata',
          'eatmydata ' + apt_get_quiet + ' dist-upgrade -y',
          './tools/download-oxen-files.sh https://oxen.rocks/oxen-io/oxen-core/oxen-stable-linux-LATEST.tar.xz',
          'mv .nvmrc .nvmrc.temp',
          'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash',
          'export NVM_DIR="$HOME/.nvm"',
          '. $NVM_DIR/nvm.sh',
          # nvm returns 3 even if there are no errors, when it finds a .nvmrc file in the current directory
          'mv .nvmrc.temp .nvmrc',
          'nvm install',
          'nvm use',
          'npm --version',
          'node --version',
          'mkdir -p $CCACHE_DIR/electron-builder',
          'mkdir -p $CCACHE_DIR/npm',
          'npm ci --cache $CCACHE_DIR/npm',
          'ELECTRON_BUILDER_CACHE=$CCACHE_DIR/electron-builder npm --cache $CCACHE_DIR/npm run build',
          './tools/ci-drone-static-upload.sh',
        ],
      },
    ],
  },

  {
    kind: 'pipeline',
    type: 'docker',
    name: 'Windows (x64)',
    platform: { arch: 'amd64' },
    steps: [
      {
        name: 'build',
        image: docker_image,
        environment: {
          SSH_KEY: { from_secret: 'SSH_KEY' },
          WINEDEBUG: '-all',
        },
        commands: [
          'echo "Building on ${DRONE_STAGE_MACHINE}"',
          'echo "man-db man-db/auto-update boolean false" | debconf-set-selections',
          apt_get_quiet + ' update',
          apt_get_quiet + ' install -y eatmydata zip wine',
          'eatmydata ' + apt_get_quiet + ' dist-upgrade -y',
          './tools/download-oxen-files.sh https://oxen.rocks/oxen-io/oxen-core/oxen-stable-win-LATEST.zip',
          'mv .nvmrc .nvmrc.temp',
          'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash',
          'export NVM_DIR="$HOME/.nvm"',
          '. $NVM_DIR/nvm.sh',
          # nvm returns 3 even if there are no errors, when it finds a .nvmrc file in the current directory
          'mv .nvmrc.temp .nvmrc',
          'nvm install',
          'nvm use',
          'wine bin/oxend.exe --version',
          'wine bin/oxen-wallet-rpc.exe --version',
          'npm --version',
          'node --version',
          'mkdir -p $CCACHE_DIR/electron-builder',
          'mkdir -p $CCACHE_DIR/npm',
          'npm ci --cache $CCACHE_DIR/npm',
          'ELECTRON_BUILDER_CACHE=$CCACHE_DIR/electron-builder npm --cache $CCACHE_DIR/npm run windows',
          './tools/ci-drone-static-upload.sh',
        ],
      },
    ],
  },

  {
    kind: 'pipeline',
    type: 'exec',
    name: 'MacOS (unsigned)',
    platform: { os: 'darwin', arch: 'amd64' },
    steps: [
      {
        name: 'build',
        environment: {
          SSH_KEY: { from_secret: 'SSH_KEY' },
          CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        },
        commands: [
          'echo "Building on ${DRONE_STAGE_MACHINE}"',
          './tools/download-oxen-files.sh https://oxen.rocks/oxen-io/oxen-core/oxen-stable-macos-LATEST.tar.xz',
          'pwd',
          'ls -la',
          'cat .nvmrc',
          '. /opt/local/share/nvm/init-nvm.sh --no-use',
          'nvm install',
          'nvm use',
          'npm --version',
          'node --version',
          '/opt/local/bin/virtualenv-3.10 venv',
          '. venv/bin/activate',
          'mkdir -p $CCACHE_DIR/electron-builder',
          'mkdir -p $CCACHE_DIR/npm',
          'npm ci --cache $CCACHE_DIR/npm',
          'ELECTRON_BUILDER_CACHE=$CCACHE_DIR/electron-builder WINEDEBUG=-all npm --cache $CCACHE_DIR/npm run build',
          './tools/ci-drone-static-upload.sh',
        ],
      },
    ],
  },

]

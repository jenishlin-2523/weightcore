# Repo setup notes

Excluded from this repo (see .gitignore):

1. **config.json** - copy config.example.json to config.json and fill in real credentials.
2. **bin/ffmpeg.exe** - needed for camera capture but 139 MB (over GitHub's limit). Download a Windows x64 static ffmpeg build (gyan.dev or BtbN releases) into bin\.
3. **node_modules / dist** - run 'npm install'; 'npm run dist' rebuilds the installer.

Passwords in selftest.js, test-save2.js and README.md are redacted to CHANGE-ME in this copy.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const fontsDir = path.join(__dirname, 'fonts');
if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir);

const regular = path.join(fontsDir, 'NotoSansCJK-Regular.ttc');
const bold = path.join(fontsDir, 'NotoSansCJK-Bold.ttc');

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function setupFonts() {
  // Try apt-get first
  try {
    execSync('apt-get install -y fonts-noto-cjk 2>/dev/null', { stdio: 'pipe' });
    const src = '/usr/share/fonts/opentype/noto';
    if (fs.existsSync(`${src}/NotoSansCJK-Regular.ttc`)) {
      fs.copyFileSync(`${src}/NotoSansCJK-Regular.ttc`, regular);
      fs.copyFileSync(`${src}/NotoSansCJK-Bold.ttc`, bold);
      console.log('Fonts installed via apt-get');
      return;
    }
  } catch (e) {
    console.log('apt-get failed, trying direct download...');
  }

  // Download from GitHub releases
  if (!fs.existsSync(regular)) {
    console.log('Downloading NotoSansCJK-Regular...');
    try {
      await downloadFile(
        'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTC/NotoSansCJK-Regular.ttc',
        regular
      );
      console.log('Downloaded Regular font');
    } catch (e) {
      console.error('Failed to download Regular font:', e.message);
    }
  }

  if (!fs.existsSync(bold)) {
    console.log('Downloading NotoSansCJK-Bold...');
    try {
      await downloadFile(
        'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTC/NotoSansCJK-Bold.ttc',
        bold
      );
      console.log('Downloaded Bold font');
    } catch (e) {
      console.error('Failed to download Bold font:', e.message);
    }
  }

  if (fs.existsSync(regular) && fs.existsSync(bold)) {
    console.log('Fonts ready!');
  } else {
    console.error('Font setup failed!');
  }
}

setupFonts();

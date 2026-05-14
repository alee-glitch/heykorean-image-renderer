// 배포 시 폰트 자동 설치 스크립트
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const fontsDir = path.join(__dirname, 'fonts');
if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir);

const regular = path.join(fontsDir, 'NotoSansCJK-Regular.ttc');
const bold = path.join(fontsDir, 'NotoSansCJK-Bold.ttc');

if (!fs.existsSync(regular) || !fs.existsSync(bold)) {
  console.log('Installing Korean fonts...');
  try {
    execSync('apt-get install -y fonts-noto-cjk 2>/dev/null || true', { stdio: 'inherit' });
    const src = '/usr/share/fonts/opentype/noto';
    if (fs.existsSync(`${src}/NotoSansCJK-Regular.ttc`)) {
      fs.copyFileSync(`${src}/NotoSansCJK-Regular.ttc`, regular);
      fs.copyFileSync(`${src}/NotoSansCJK-Bold.ttc`, bold);
      console.log('Fonts installed successfully');
    }
  } catch (e) {
    console.error('Font install failed:', e.message);
  }
} else {
  console.log('Fonts already present');
}

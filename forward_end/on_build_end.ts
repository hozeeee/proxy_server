import fs from 'fs-extra';
import path from 'path';

const COPY_FILE_LIST = [
  './dist/forward_main_programme.js',

  './README.md',
];
const TARGET_DIR = '../midway_server/publish/forward_end';

fs.ensureDirSync(TARGET_DIR);

for (const filepath of COPY_FILE_LIST) {
  const pathArr = filepath.split('/');
  const filename = pathArr[pathArr.length - 1];
  fs.copyFileSync(
    path.join(process.cwd(), filepath),
    path.join(process.cwd(), `${TARGET_DIR}/${filename}`)
  );
}






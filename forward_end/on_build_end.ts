import fs from 'fs-extra';
import path from 'path';

const TARGET_DIR = '../server/publish/forward_end';
fs.ensureDirSync(TARGET_DIR);


/**
 * 配置被复制的文件和目录。
 * 说明:
 *   1. 对于文件，都会被拷贝到 TARGET_DIR 的一级目录下，忽略来源的路径。
 *   2. 对于目录，会整个目录拷贝到 TARGET_DIR 下。
 */
const COPY_FILE_LIST = [
  './dist/end_manager.js',
  './README.md',
];
const COPY_FILE_DIRS = [
  './src/forward_end/src/shell',
];


for (const filepath of COPY_FILE_LIST) {
  const pathArr = filepath.split('/');
  const filename = pathArr[pathArr.length - 1];
  fs.copyFileSync(
    path.join(process.cwd(), filepath),
    path.join(process.cwd(), `${TARGET_DIR}/${filename}`)
  );
}

for (const dir of COPY_FILE_DIRS) {
  fs.copySync(
    path.join(process.cwd(), dir),
    path.join(process.cwd(), TARGET_DIR, dir)
  );
}






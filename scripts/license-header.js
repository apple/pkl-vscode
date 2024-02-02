const { resolve } = require('path');
const { readdir } = require('fs').promises;
const { readFileSync, writeSync, openSync, close } = require('fs');
const path = require('path')

async function getFiles(dir) {
  const dirents = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(dirents.map((dirent) => {
    const res = resolve(dir, dirent.name);
    return dirent.isDirectory() ? getFiles(res) : res;
  }));
  return Array.prototype.concat(...files);
}


(() => {
  const arg0 = process.argv.length >= 3 ? process.argv[2] : "";
  const license = readFileSync(path.join(__dirname, "license-header.txt"), "utf-8");

  getFiles(path.join(__dirname, "..", "src"))
    .then(files => {
      const insert = Buffer.from(license);
      let errs = [];
      for (const file of files) {
        const data = readFileSync(file, "utf-8");
        if (arg0 === "test") {
          if (!data.startsWith(license)) {
            errs.push(`Error: File ${file} has no license header`);
          }
        } else {
          if (!data.startsWith(license)) {
            const dataBuffer = readFileSync(file);
            const fd = openSync(file, "w+");
            writeSync(fd, insert, 0, insert.length, 0);
            writeSync(fd, dataBuffer, 0, data.length, insert.length);
            close(fd, (err) => {
              if (err) throw err;
            });
          }
        }
      }
      if (errs.length > 0) {
        errs.forEach((err) => console.log(err));
        process.exit(1);
      }
    })
    .catch(e => console.error(e))
})()

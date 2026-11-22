const fs = require('node:fs');
const Parser = require('./test-tools/node_modules/php-parser');
const parser = new Parser({parser:{version:'8.4', suppressErrors:false}});
for (const dir of ['', 'public/', 'private/']) {
  for (const name of fs.readdirSync(__dirname+'/'+dir).filter(n=>n.endsWith('.php'))) {
    const file=dir+name;
    parser.parseCode(fs.readFileSync(__dirname+'/'+file,'utf8'),file);
    console.log(file+': PHP syntax passed');
  }
}

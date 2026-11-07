'use strict';
// Gebruik: npm run create-user -- <gebruikersnaam> "<naam>" [--admin]
// Het wachtwoord wordt gevraagd (wordt niet getoond).
const readline = require('node:readline');
const auth = require('../src/auth');

const args = process.argv.slice(2);
const isAdmin = args.includes('--admin');
const [username, name] = args.filter((a) => a !== '--admin');
if (!username) {
  console.log('Gebruik: npm run create-user -- <gebruikersnaam> "<naam>" [--admin]');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const password = process.env.NEW_USER_PASSWORD || (await askHidden('Wachtwoord: '));
  try {
    await auth.createUser({ username, name: name || username, password, isAdmin });
    console.log(`Gebruiker "${username}" aangemaakt${isAdmin ? ' (beheerder)' : ''}.`);
  } catch (err) {
    console.error('Fout: ' + err.message);
    process.exit(1);
  }
})();

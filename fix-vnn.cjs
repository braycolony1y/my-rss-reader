const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));

let changed = false;

['readStates', 'savedStates', 'boardStates'].forEach(stateName => {
    let states = typeof db[stateName] === 'string' ? JSON.parse(db[stateName]) : (db[stateName] || []);
    let updated = states.map(link => {
        if (link.includes('2537956') && link.includes('tinh-mang')) {
            changed = true;
            return link.replace('tinh-mang-cuu-hai-nguoi', 'khi-cuu-hai-nguoi');
        }
        return link;
    });
    db[stateName] = JSON.stringify(updated);
});

if (changed) {
    fs.writeFileSync('./database.json', JSON.stringify(db));
    console.log('Fixed states');
}

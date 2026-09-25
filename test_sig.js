const crypto = require('crypto');

const samples = [
  {
    time: '1790314786',
    requestId: '08c4806f-020a-48d4-97af-ec9b3012cdb7',
    person: '5359',
    expected: '95540b5353f9e25e03911a3524ea83564baece32a7705cbbeafadc81aa6d48d0'
  },
  {
    time: '1790314787',
    requestId: '0f876334-4fc1-4c4b-b9b9-28fcfcfc4112',
    person: '5359',
    expected: 'ef68b480b419d138d427d3bd6a2dd77ae946ee2d2df69830eb9040cd16e5668a'
  }
];

const keys = ['secret', 'joincare', 'jc', ''];

function getCandidates(s) {
  return [
    s.time,
    s.requestId,
    s.person,
    s.time + s.requestId,
    s.requestId + s.time,
    s.time + s.person,
    s.person + s.time,
    s.time + s.requestId + s.person,
    s.person + s.time + s.requestId,
    s.requestId + s.person + s.time,
  ];
}

let found = false;
for (const key of keys) {
  for (const s of samples) {
    for (const input of getCandidates(s)) {
      const hash = crypto.createHmac('sha256', key).update(input).digest('hex');
      if (hash === s.expected) {
        console.log(`KETEMU! key="${key}" input="${input}"`);
        found = true;
      }
    }
  }
}

if (!found) console.log('Tidak ketemu. Perlu cari key dari JS bundle.');
console.log('done');

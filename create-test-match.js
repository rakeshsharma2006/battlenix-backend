require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const Match = require('./src/models/Match');
  const User = require('./src/models/User');
  const bcrypt = require('bcryptjs');

  const players = [];

  for (let i = 1; i <= 9; i++) {
    let u = await User.findOne({ username: 'roomplayer' + i });

    if (!u) {
      const hash = await bcrypt.hash('Test@1234', 10);

      u = await User.create({
        username: 'roomplayer' + i,        // 🔁 changed username
        email: 'roomplayer' + i + '@game.com', // 🔁 changed email
        password: hash,
        gameUID: '71234567' + i,           // 🔁 changed UID
        gameName: 'ProPlayer' + i,         // 🔁 changed player display name
        upiId: 'proplayer' + i + '@upi'
      });

      console.log('Created user: roomplayer' + i);
    } else {
      console.log('Found user: roomplayer' + i);
    }

    players.push(u._id);
  }

  const match = await Match.create({
    title: '🔥 Custom Room Battle',   // 🔁 ROOM NAME CHANGED
    game: 'BGMI',
    map: 'Erangel',
    mode: 'Solo',
    entryFee: 20,
    maxPlayers: 10,
    playersCount: 9,
    players: players,
    status: 'UPCOMING',
    startTime: new Date(Date.now() + 30 * 60 * 1000),
    prizeBreakdown: {
      playerPrize: 130,
      managerCut: 20,
      adminCut: 50
    }
  });

  console.log('\n✅ Match created successfully!');
  console.log('Match ID:', match._id.toString());
  console.log('Room Name: 🔥 Custom Room Battle');
  console.log('Status: UPCOMING | Players: 9/10');

  process.exit(0);
}).catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
import mongoose from 'mongoose';
import { connectDB, Watchlist, QuarterlyState, Shareholding } from './db';

const MONGODB_URI = process.env.MONGODB_URI;

const resetDatabase = async () => {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Create a .env file or pass it as an env variable.');
    process.exit(1);
  }

  await connectDB(MONGODB_URI);

  console.log('⚠️  Dropping all collections...');
  const collections = await mongoose.connection.db!.listCollections().toArray();
  for (const col of collections) {
    await mongoose.connection.db!.dropCollection(col.name);
    console.log(`  ✗ Dropped: ${col.name}`);
  }

  console.log('\n✅ Database wiped clean.');
  console.log('Collections recreated on first insert by Mongoose.\n');

  await mongoose.disconnect();
  process.exit(0);
};

resetDatabase().catch(err => {
  console.error('Reset failed:', err);
  process.exit(1);
});

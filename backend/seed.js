require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Bus = require('./models/Bus');
const Route = require('./models/Route');
const bcryptjs = require('bcryptjs');

const seedDatabase = async () => {
  try {
    console.log('🌱 Starting database seeding...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.MONGODB_DB_NAME || 'lankaBus',
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Clear existing data (optional - comment out to keep data)
    // await User.deleteMany({});
    // await Bus.deleteMany({});
    // await Route.deleteMany({});
    // console.log('🗑️ Cleared existing data');

    // Create Test Users
    const salt = await bcryptjs.genSalt(10);
    const hashedPassword = await bcryptjs.hash('Test@123456', salt);

    const users = await User.insertMany([
      {
        email: 'admin1@test.com',
        password: hashedPassword,
        firstName: 'System',
        lastName: 'Admin',
        phoneNumber: '0700000000',
        userType: 'user',
        isVerified: true,
        walletBalance: 0,
      },
      {
        email: 'passenger1@test.com',
        password: hashedPassword,
        firstName: 'John',
        lastName: 'Doe',
        phoneNumber: '0712345678',
        userType: 'user',
        isVerified: true,
        walletBalance: 0,
      },
      {
        email: 'passenger2@test.com',
        password: hashedPassword,
        firstName: 'Jane',
        lastName: 'Smith',
        phoneNumber: '0723456789',
        userType: 'user',
        isVerified: true,
        walletBalance: 0,
      },
      {
        email: 'conductor1@test.com',
        password: hashedPassword,
        firstName: 'Conductor',
        lastName: 'One',
        phoneNumber: '0734567890',
        userType: 'conductor',
        isVerified: true,
        walletBalance: 0,
      },
    ]);
    console.log(`✅ Created ${users.length} test users`);

    // Create Routes
    const routes = await Route.insertMany([
      {
        routeNumber: 'C1',
        startLocation: 'Colombo Fort',
        endLocation: 'Kandy City Center',
        operator: users[0]._id,
        stops: [
          { name: 'Colombo Fort', time: '06:00', coordinates: { lat: 6.9271, lng: 80.6270 }, sequence: 1 },
          { name: 'Rawatawatta', time: '06:45', coordinates: { lat: 7.0089, lng: 80.7789 }, sequence: 2 },
          { name: 'Peradeniya', time: '07:15', coordinates: { lat: 7.2549, lng: 80.7789 }, sequence: 3 },
          { name: 'Kandy City Center', time: '08:00', coordinates: { lat: 7.2906, lng: 80.6337 }, sequence: 4 },
        ],
        estimatedDuration: 120,
        baseFare: 450,
        isActive: true,
        operatingDays: [0, 1, 2, 3, 4, 5, 6],
        operatingHours: { start: '06:00', end: '22:00' },
      },
      {
        routeNumber: 'C2',
        startLocation: 'Colombo Fort',
        endLocation: 'Galle Face',
        operator: users[0]._id,
        stops: [
          { name: 'Colombo Fort', time: '07:00', coordinates: { lat: 6.9271, lng: 80.6270 }, sequence: 1 },
          { name: 'Bambalapitiya', time: '07:20', coordinates: { lat: 6.9256, lng: 80.2505 }, sequence: 2 },
          { name: 'Dehiwala', time: '07:40', coordinates: { lat: 6.8240, lng: 80.2505 }, sequence: 3 },
          { name: 'Galle Face', time: '08:00', coordinates: { lat: 6.9344, lng: 80.2675 }, sequence: 4 },
        ],
        estimatedDuration: 60,
        baseFare: 150,
        isActive: true,
        operatingDays: [0, 1, 2, 3, 4, 5, 6],
        operatingHours: { start: '06:00', end: '23:00' },
      },
      {
        routeNumber: 'M1',
        startLocation: 'Colombo Fort',
        endLocation: 'Matara',
        operator: users[0]._id,
        stops: [
          { name: 'Colombo Fort', time: '05:30', coordinates: { lat: 6.9271, lng: 80.6270 }, sequence: 1 },
          { name: 'Mount Lavinia', time: '06:15', coordinates: { lat: 6.8283, lng: 80.2667 }, sequence: 2 },
          { name: 'Moratuwa', time: '06:45', coordinates: { lat: 6.8067, lng: 80.2923 }, sequence: 3 },
          { name: 'Matara', time: '08:30', coordinates: { lat: 5.7489, lng: 80.5380 }, sequence: 4 },
        ],
        estimatedDuration: 180,
        baseFare: 600,
        isActive: true,
        operatingDays: [0, 1, 2, 3, 4, 5, 6],
        operatingHours: { start: '05:30', end: '20:00' },
      },
      {
        routeNumber: 'N1',
        startLocation: 'Colombo Fort',
        endLocation: 'Negombo',
        operator: users[0]._id,
        stops: [
          { name: 'Colombo Fort', time: '06:15', coordinates: { lat: 6.9271, lng: 80.6270 }, sequence: 1 },
          { name: 'Peliyagoda', time: '06:35', coordinates: { lat: 6.9612, lng: 79.8804 }, sequence: 2 },
          { name: 'Ja-Ela', time: '07:05', coordinates: { lat: 7.0740, lng: 79.8910 }, sequence: 3 },
          { name: 'Negombo', time: '07:35', coordinates: { lat: 7.2083, lng: 79.8358 }, sequence: 4 },
        ],
        estimatedDuration: 90,
        baseFare: 220,
        isActive: true,
        operatingDays: [0, 1, 2, 3, 4, 5, 6],
        operatingHours: { start: '06:00', end: '21:00' },
      },
      {
        routeNumber: 'A1',
        startLocation: 'Colombo Fort',
        endLocation: 'Anuradhapura',
        operator: users[0]._id,
        stops: [
          { name: 'Colombo Fort', time: '05:30', coordinates: { lat: 6.9271, lng: 80.6270 }, sequence: 1 },
          { name: 'Kurunegala', time: '07:00', coordinates: { lat: 7.4863, lng: 80.3647 }, sequence: 2 },
          { name: 'Dambulla', time: '08:00', coordinates: { lat: 7.8569, lng: 80.6499 }, sequence: 3 },
          { name: 'Anuradhapura', time: '09:30', coordinates: { lat: 8.3114, lng: 80.4037 }, sequence: 4 },
        ],
        estimatedDuration: 240,
        baseFare: 850,
        isActive: true,
        operatingDays: [0, 1, 2, 3, 4, 5, 6],
        operatingHours: { start: '05:30', end: '19:30' },
      },
    ]);
    console.log(`✅ Created ${routes.length} routes`);

    // Users already created above

    // Create Buses
    const buses = await Bus.insertMany([
      {
        busNumber: 'WP-SL-1234',
        route: routes[0]._id,
        totalSeats: 45,
        occupiedSeats: 12,
        conductor: users[3]._id, // conductor1
        latitude: 6.9271,
        longitude: 80.6270,
        status: 'running',
        registrationExpiry: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        insuranceExpiry: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
      },
      {
        busNumber: 'WP-SL-5678',
        route: routes[1]._id,
        totalSeats: 40,
        occupiedSeats: 25,
        conductor: users[3]._id, // conductor1
        latitude: 6.9256,
        longitude: 80.2505,
        status: 'running',
        registrationExpiry: new Date(Date.now() + 150 * 24 * 60 * 60 * 1000),
        insuranceExpiry: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000),
      },
      {
        busNumber: 'WP-SL-9012',
        route: routes[2]._id,
        totalSeats: 50,
        occupiedSeats: 38,
        latitude: 6.8283,
        longitude: 80.2667,
        status: 'running',
        registrationExpiry: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
        insuranceExpiry: new Date(Date.now() + 140 * 24 * 60 * 60 * 1000),
      },
      {
        busNumber: 'WP-SL-3456',
        route: routes[3]._id,
        totalSeats: 45,
        occupiedSeats: 10,
        latitude: 6.9612,
        longitude: 79.8804,
        status: 'running',
        registrationExpiry: new Date(Date.now() + 160 * 24 * 60 * 60 * 1000),
        insuranceExpiry: new Date(Date.now() + 110 * 24 * 60 * 60 * 1000),
      },
      {
        busNumber: 'WP-SL-7890',
        route: routes[4]._id,
        totalSeats: 45,
        occupiedSeats: 14,
        latitude: 7.4863,
        longitude: 80.3647,
        status: 'running',
        registrationExpiry: new Date(Date.now() + 170 * 24 * 60 * 60 * 1000),
        insuranceExpiry: new Date(Date.now() + 130 * 24 * 60 * 60 * 1000),
      },
    ]);
    console.log(`✅ Created ${buses.length} buses`);

    console.log('\n');
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║   🌱 Database Seeding Completed Successfully   ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('\n📋 Test Credentials:\n');
    console.log('Passenger Account:');
    console.log('  Email: passenger1@test.com');
    console.log('  Password: Test@123456\n');
    console.log('Conductor Account:');
    console.log('  Email: conductor1@test.com');
    console.log('  Password: Test@123456\n');
    console.log('Routes Created:');
    console.log('  - C1: Colombo Fort → Kandy (450 LKR)');
    console.log('  - C2: Colombo Fort → Galle Face (150 LKR)');
    console.log('  - M1: Colombo Fort → Matara (600 LKR)');
    console.log('  - N1: Colombo Fort → Negombo (220 LKR)');
    console.log('  - A1: Colombo Fort → Anuradhapura (850 LKR)\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
};

seedDatabase();

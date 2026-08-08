require('dotenv').config();
const m=require('./20260808_pending_product_requests.js');
const pool=require('../config/database').createPool();
m.up(pool).then(()=>{console.log('pending_product_requests done'); pool.end().then(()=>process.exit(0));}).catch(e=>{console.error(e); process.exit(1);});

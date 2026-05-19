// firebase/config.js
import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyBMedb_hj1dVsu-olcZDbayBNSUsdkWUBo",
  authDomain: "mobileprogramming-dawhat.firebaseapp.com",
  databaseURL: "https://mobileprogramming-dawhat-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "mobileprogramming-dawhat",
  appId: "1:619077062615:ios:df5ab46b06377a77ef0592",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
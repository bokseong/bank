import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

const firebaseConfig={apiKey:'AIzaSyCRa76LiXlBo2KG-lOFV32RVSVHm0L56uQ',authDomain:'hs-bokseong.firebaseapp.com',projectId:'hs-bokseong',databaseURL:'https://hs-bokseong-default-rtdb.asia-southeast1.firebasedatabase.app',storageBucket:'hs-bokseong.firebasestorage.app',messagingSenderId:'923295250107',appId:'1:923295250107:web:43ec7bbeefd7cc564cdb9e',measurementId:'G-H56C0TJGFM'};
export const app=initializeApp(firebaseConfig);
// The Enterprise site key is public by design. Do not put the provider secret in this client code.
export const appCheck=initializeAppCheck(app,{
  provider:new ReCaptchaEnterpriseProvider('6LeTORYuAAAAAMvEjJ8cbklms8rWzp9TTzJXnS1d'),
  isTokenAutoRefreshEnabled:true,
});
export const auth=getAuth(app);
export const db=getFirestore(app);
export const rtdb=getDatabase(app);
isSupported().then(ok=>ok&&getAnalytics(app)).catch(()=>{});

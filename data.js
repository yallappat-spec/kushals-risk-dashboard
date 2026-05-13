/* =============================================
   KUSHALS STORE RISK DASHBOARD — data.js
   
   This file contains the SAMPLE data shown
   by default until you upload your CSV.
   
   To update sample data:
   - Edit the values below
   - shrinkage : use % value  e.g. -0.092 means -0.092%
   - opsScore  : use number   e.g. 74 means 74%
   - fraud     : true or false
   ============================================= */

const SAMPLE = [
  { store: 'Koramangala',          region: 'Bangalore',           shrinkage: -0.092, opsScore: 74,  fraud: true  },
  { store: 'Indiranagar',          region: 'Bangalore',           shrinkage: -0.045, opsScore: 91,  fraud: false },
  { store: 'Jayanagar',            region: 'Bangalore',           shrinkage: -0.031, opsScore: 93,  fraud: false },
  { store: 'Whitefield',           region: 'Bangalore',           shrinkage: -0.078, opsScore: 82,  fraud: true  },
  { store: 'Rajajinagar',          region: 'Bangalore',           shrinkage: -0.058, opsScore: 85,  fraud: false },
  { store: 'Kukatpally',           region: 'Hyderabad',           shrinkage: -0.112, opsScore: 61,  fraud: true  },
  { store: 'Ameerpet',             region: 'Hyderabad',           shrinkage: -0.067, opsScore: 80,  fraud: false },
  { store: 'LB Nagar',             region: 'Hyderabad',           shrinkage: -0.038, opsScore: 94,  fraud: false },
  { store: 'KPHB',                 region: 'Hyderabad',           shrinkage: -0.085, opsScore: 71,  fraud: true  },
  { store: 'T Nagar',              region: 'Chennai',             shrinkage: -0.071, opsScore: 83,  fraud: true  },
  { store: 'Anna Nagar',           region: 'Chennai',             shrinkage: -0.042, opsScore: 90,  fraud: false },
  { store: 'Velachery',            region: 'Chennai',             shrinkage: -0.099, opsScore: 65,  fraud: true  },
  { store: 'Tambaram',             region: 'Chennai',             shrinkage: -0.029, opsScore: 95,  fraud: false },
  { store: 'Andheri',              region: 'Mumbai',              shrinkage: -0.088, opsScore: 72,  fraud: true  },
  { store: 'Thane',                region: 'Mumbai',              shrinkage: -0.052, opsScore: 86,  fraud: false },
  { store: 'Borivali',             region: 'Mumbai',              shrinkage: -0.034, opsScore: 92,  fraud: false },
  { store: 'Dadar',                region: 'Mumbai',              shrinkage: -0.076, opsScore: 78,  fraud: true  },
  { store: 'Thrissur',             region: 'Kerala',              shrinkage: -0.048, opsScore: 88,  fraud: false },
  { store: 'Kozhikode',            region: 'Kerala',              shrinkage: -0.033, opsScore: 96,  fraud: false },
  { store: 'Ernakulam',            region: 'Kerala',              shrinkage: -0.065, opsScore: 81,  fraud: true  },
];

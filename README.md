# Kushals Store Risk Dashboard

**Built by:** Yallappa Tenkappanavar — Head of Inventory & Operations Audit and Loss Prevention  
**Company:** Kushals Fashion Jewellery (Kushals Retail Pvt. Ltd.)

---

## Project structure

```
kushals-risk-dashboard/
│
├── index.html      ← Main page (structure/layout)
├── style.css       ← All visual styling
├── app.js          ← All dashboard logic
├── data.js         ← Sample store data
│
└── data/           ← Put your monthly CSV files here
    └── store_data_may2026.csv
```

---

## How to run locally

1. Open this folder in **VS Code**
2. Install the **Live Server** extension (by Ritwick Dey)
3. Right-click `index.html` → **Open with Live Server**
4. Dashboard opens in your browser automatically

---

## Risk scoring rules

| Parameter        | Condition        | Points |
|-----------------|------------------|--------|
| Shrinkage        | > 0.075%         | +30%   |
| Ops scorecard    | >= 90%           | +0%    |
| Ops scorecard    | 80–89%           | +20%   |
| Ops scorecard    | < 80%            | +30%   |
| Fraud            | Occurred         | +20%   |

- **High risk** = total score >= 50%  
- **Medium risk** = total score >= 20%  
- **Low risk** = total score < 20%

---

## How to upload your store data

Prepare a CSV file with these exact column headers:

| Store | Region | Shrinkage | OpsScore | Fraud |
|-------|--------|-----------|----------|-------|
| Store Name | Bangalore | -0.082% | 85% | No |

- Click **"Download blank template CSV"** in the dashboard for a ready-made file
- Fill in your data in Excel and save as CSV
- Click the upload area in the dashboard

---

## How to update sample data

Open `data.js` in VS Code and edit the SAMPLE array.  
Each store follows this format:

```js
{ store: 'Store Name', region: 'Region', shrinkage: -0.092, opsScore: 74, fraud: true },
```

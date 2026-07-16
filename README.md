# ABC Fitness Change Intelligence

An upload-based dashboard for analyzing Jira change exports. It reads CSV, TSV, TXT, XLSX, and XLSM files with no third-party Python packages, and it can be run locally or deployed from GitHub for team use.

## Run Locally

```powershell
python app.py
```

Open `http://127.0.0.1:8000`.

## Put It In GitHub

Create a new GitHub repository, then upload these project files:

- `app.py`
- `static/`
- `README.md`
- `requirements.txt`
- `render.yaml`
- `.gitignore`

If you are using Git on your machine, the usual flow is:

```powershell
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## Share It With Teammates

GitHub is the code home, but teammates will need a deployed web link to use the app in the browser.

The easiest path is Render:

1. Push this project to GitHub.
2. In Render, create a new Web Service from that GitHub repository.
3. Render will detect `render.yaml`.
4. Deploy the service.
5. Share the generated HTTPS URL with your team.

This app now listens on the hosting platform's `PORT` and `HOST`, so it can run both locally and in the cloud.

## File Columns

The app auto-detects common column names for:

- Assignment Group / Team
- Status
- Planned start date
- Planned end date
- Change start date
- Completed date
- Key / Change ID
- Summary / Change title

If the file uses different names, update the field selectors after upload. The dashboard recalculates immediately.

## Outputs

- Planned vs completed timeline chart
- Changes by team chart
- Not completed by team chart
- Late CAB submissions by team chart for Normal changes only
- On-time finish rate by team chart
- Status mix chart
- Change type mix chart
- Risk level mix chart
- Team-level report with volume, completion rate, on-time count, late finish count, open-past-plan count, outside-timeline count, and average delay
- Timeline exception drilldown
- Clickable KPI cards and clickable chart values that open matching changes
- Clickable metrics that open the matching Jira changes
- CSV export of the team report
- CSV export of the currently visible drilldown
- Executive PowerPoint summary deck with paginated timeline, change type, status, on-time finish rate, and team charts

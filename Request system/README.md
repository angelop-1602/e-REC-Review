# SPUP REC - Letter & Voucher Creation System

A modern, integrated web-based application built with Streamlit for automating Research Ethics Committee (REC) letter and voucher generation with reviewer data from CSV files.

## 📁 Project Structure

```
spup_rec_system/
├── src/                    # Source code modules
│   ├── __init__.py
│   ├── config.py          # Configuration and constants
│   ├── utils.py           # Utility functions
│   ├── data_processor.py  # Data processing functions
│   ├── document_generator.py  # Letter generation
│   └── voucher_generator.py   # Voucher generation
├── templates/             # Word document templates
│   ├── Letter_Template.docx
│   └── Template_Voucher.docx
├── data/                  # Sample data files
│   └── sample_data.csv
├── output/                # Generated documents (created automatically)
├── app.py                 # Main Streamlit application entry point
├── requirements.txt       # Python dependencies
├── run_app.bat           # Windows batch file to run the app
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

## ✨ Features

- 📅 **Date Selection**: Choose letter date (defaults to current date)
- 🎓 **Education Level Selection**: Undergraduate (₱300/review) or Graduate (₱500/review)
- 📊 **Flexible Data Input**: Upload CSV file OR paste CSV data directly
- 📋 **Data Preview**: Interactive data tables with preview
- 📈 **Summary Statistics**: Automatic calculation of reviewer statistics and totals
- 📄 **Word Document Generation**: Professional letter generation with template replacement
- 🧾 **Voucher Creation**: Generate individual vouchers for all reviewers
- 💾 **Download**: Direct download of generated letters and vouchers
- ✅ **Reviewer Validation**: Validates reviewers against registered list

## 🚀 Installation

1. **Clone or download the project files**

2. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Ensure you have the templates**:
   - Make sure `Letter_Template.docx` is in the `templates/` directory
   - Make sure `Template_Voucher.docx` is in the `templates/` directory
   - The templates should contain the placeholders mentioned below

## 💻 Usage

### Windows (Quick Start)
Double-click `run_app.bat` or run:
```bash
streamlit run app.py
```

### Manual Start
```bash
streamlit run app.py
```

The application will open in your default browser at `http://localhost:8501`

## 📖 How to Use

### Letter Generation:
1. **📅 Select Date**: Choose the date for your letter
2. **🎓 Choose Education Level**: Undergraduate (₱300) or Graduate (₱500)
3. **📅 Select Period**: Choose start month, end month, and year using dropdowns
4. **📊 Input Data**: 
   - Option 1: Upload CSV file
   - Option 2: Paste CSV data directly (click "Load Sample Data" to see format)
5. **👀 Review Data**: Check preview and summary tables
6. **🔄 Generate Letter**: Creates Word document with formatted tables

### Voucher Creation:
1. **Input data** in Letter Generation first (upload or paste)
2. **Switch to Voucher Creation** tab
3. **Review voucher summary** for all reviewers
4. **Generate vouchers** - creates individual voucher pages for each reviewer

## 📄 File Format Requirements

Your CSV file should include these columns:
- **OR**: Order/Reference number
- **SPUP REC Code**: Unique REC code  
- **Principal Investigator**: Name of the principal investigator
- **Research Title**: Title of the research study
- **Course/Program**: Course or program information
- **Reviewer #1**: First reviewer name (required)
- **Reviewer #2**: Second reviewer name (required)
- **Reviewer #3**: Third reviewer name (required)

### Example CSV Format:
```csv
OR,SPUP REC Code,Principal Investigator,Research Title,Course/Program,Reviewer #1,Reviewer #2,Reviewer #3
2393487,SPUP_2025_00160_SR_MG,Mevic Chea S. Gacuya,Sample Research Title,BPEd,Mr. Rogelio Fermin,Mrs. Rita B. Daliwag,Mrs. Maria Felina B. Agbayani
2374628,SPUP_2024_0938_EX_JX,Andrei Vincent Rosales Corpuz,Another Research Title,BS Pharma,Mrs. Kristine Joy O. Cortes,Mrs. Jean Sumait,Mrs. Rita B. Daliwag
```

## 📝 Template Placeholders

The following placeholders in your Word templates will be automatically replaced:

- `<<Date_Today>>`: Selected or current date
- `<<Level>>`: Education level (Undergraduate/Graduate)
- `<<Month_Year>>`: Data collection period (e.g., "January-March, 2025")
- `<<Amount>>`: Amount per review (₱300 or ₱500)
- `<<Complete_List_Table>>`: Formatted table with all data
- `<<Summary_Table>>`: Formatted table with reviewer summary statistics

## 🔧 Dependencies

- **Streamlit**: Web application framework
- **python-docx**: Word document processing
- **pandas**: Data manipulation (for future enhancements)
- **openpyxl**: Excel file support (for future enhancements)

## 📂 Output Files

All generated documents are saved in the `output/` directory with timestamps:
- Letters: `SPUP_REC_Letter_YYYYMMDD_HHMMSS.docx`
- Vouchers: `All_Vouchers_YYYYMMDD_HHMMSS.docx`

## 🐛 Troubleshooting

### Common Issues:

1. **Template file not found**
   - Ensure `Letter_Template.docx` and `Template_Voucher.docx` are in the `templates/` directory

2. **Reviewer columns not found**
   - Check that your CSV file has columns named exactly: "Reviewer #1", "Reviewer #2", "Reviewer #3"

3. **Module import errors**
   - Make sure you're running `app.py` from the project root directory
   - Ensure all dependencies are installed: `pip install -r requirements.txt`

4. **Output directory errors**
   - The `output/` directory will be created automatically
   - If you get permission errors, check that you have write access to the project directory

## 📝 Notes

- The system validates reviewers against a predefined list
- All amounts are displayed in Philippine Peso (₱)
- Periods are formatted as words (e.g., "January-March, 2025")
- Generated files include timestamps to prevent overwriting

## 📄 License

This project is open source and available for use within SPUP.

## 👥 Support

For issues or questions, please check the Help & Documentation section within the application.


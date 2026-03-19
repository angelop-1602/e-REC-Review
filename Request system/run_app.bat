@echo off
echo ====================================================
echo   SPUP REC - Letter & Voucher Creation System
echo ====================================================
echo.
echo Make sure you have installed the requirements:
echo   pip install -r requirements.txt
echo.
echo Starting Streamlit application...
echo.
echo The application will open in your default browser.
echo If it doesn't open automatically, go to: http://localhost:8501
echo.
echo Press any key to start the application...
pause >nul

REM Activate virtual environment
call .venv\Scripts\activate.bat

REM Run the Streamlit app
streamlit run app.py

REM Deactivate virtual environment (optional)
call .venv\Scripts\deactivate.bat

echo.
echo Application stopped. Press any key to exit...
pause >nul


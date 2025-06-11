import streamlit as st
import pandas as pd
import matplotlib.pyplot as plt
from datetime import datetime
import json

def get_excel_json():
    st.title("Excel Sheet Data Analyzer (First Two Sheets)")
    
    uploaded_file = st.file_uploader("Choose an Excel file", type=['xlsx'])
    
    if uploaded_file is not None:
        try:
            # Get Excel file and first two sheet names
            xl = pd.ExcelFile(uploaded_file)
            selected_sheets = xl.sheet_names[1:]
            
            # Read first two sheets into dictionary
            dfs = pd.read_excel(
                uploaded_file,
                sheet_name=selected_sheets
            )
            
            # Create JSON
            json_data = {}
            for sheet_name in selected_sheets:
                # Replace spaces with underscores in column names
                dfs[sheet_name].columns = dfs[sheet_name].columns.str.replace(' ', '_')
                
                # Fill null values with 0
                dfs[sheet_name] = dfs[sheet_name].fillna(0)
                
                # Convert sheet data to JSON records
                records = json.loads(dfs[sheet_name].to_json(orient='records'))
                json_data[sheet_name] = records
            
            # Display JSON
            st.subheader("JSON Data of Excel Sheet:")
            st.json(json_data)
            
        except Exception as e:
            st.error(f"Error reading the file: {str(e)}")

if __name__ == "__main__":
    get_excel_json()

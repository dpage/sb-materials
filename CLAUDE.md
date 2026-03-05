# SB Materials App

This app is a simple web app for SB Materials, a small company that provides
services inspecting and auditing waste materials for resale before recycling.

The app is a multi-user web application, for low volume use. It's primary 
purpose is to log inspections for different customers, including the customer
details, materials, condition, and photos.

It will comprise of a number of relatively simple data structures:

- Users (user accounts, with a superuser flag which will give access to user 
    management functionality)
- Customers
- Reports
- Lookups for relevant data

The main interface will list all reports, in reverse date order by default, 
with easy to use options to filter, search, and sort by customer, date, and
other useful fields. A button will allow the user to create a new report, 
including a button next to all relevant dropdowns to allow the user to quickly
add (for example) a new customer. Action buttons will be provided to allow
the user to Edit, Delete (with confirmation), and download the report in PDF 
format.

Additional menu options should be included to allow CRUD operations for lookups,
including users and customers.

Reference information can be found in /reference, including discussions,
sample reports, and links to existing Google Forms which this app will replace.
The reference information MUST be read, and fully taken into account.

The application MUST be quick and simple to use. Entering new reports 
efficiently is of paramount importance.

Data will be stored in SQLite in a configurable location, with photos being
stored in the same condfigurable location, and referenced from the database
by path.

The application should be written in Typescript, and should be trivial to 
deploy behind NGinx on Linux.
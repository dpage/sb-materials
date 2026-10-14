export interface HelpSection {
  title: string;
  body: string;
}

export interface HelpTopic {
  heading: string;
  sections: HelpSection[];
}

export const helpTopics: Record<string, HelpTopic> = {
  reports: {
    heading: 'Reports',
    sections: [
      {
        title: 'Overview',
        body: 'The Reports page is your main workspace. It lists all inspection reports in reverse date order, showing the date, customer, report type, inspector, and status at a glance.',
      },
      {
        title: 'Creating a Report',
        body: 'Click the "+ New Report" button to start a new inspection report. You will be taken to the report form where you can select the report type, customer, site, and fill in the inspection details.',
      },
      {
        title: 'Searching',
        body: 'Use the search box at the top to find reports by customer name, inspector name, or other information. Results update as you type.',
      },
      {
        title: 'Filtering',
        body: 'Click the "Filters" button to reveal filter options. You can filter by customer, report type (Loading & Inspection, Quarterly PERN Inspection, PERN Audit), status (Draft, Assigned, or Completed), and date range. There is also an "Assigned to me" filter to show only the reports assigned to you. A badge on the Filters button shows how many filters are active.',
      },
      {
        title: 'Report Actions',
        body: 'Each report row has actions:\n\n- Edit: Open the report for editing\n- PDF: Download the report as a formatted PDF document\n- Submit: On an Assigned report, mark it Completed and send it back to the owner\n- Reopen: On a Completed report, move it back to Assigned for further changes\n- Delete: Permanently remove the report (you will be asked to confirm)',
      },
      {
        title: 'Report Status',
        body: 'Reports move through three statuses:\n\n- Draft: being set up\n- Assigned: handed to an inspector to complete on site\n- Completed: signed off and back with the owner\n\nReopen a completed report if it needs further changes.',
      },
      {
        title: 'Pagination',
        body: 'Reports are shown 25 per page. Use the Prev and Next buttons at the bottom to navigate between pages.',
      },
    ],
  },

  'report-edit': {
    heading: 'Report Form',
    sections: [
      {
        title: 'Overview',
        body: 'The report form is used to create and edit inspection reports. The form adapts based on the selected report type, showing only the fields relevant to that type of inspection.',
      },
      {
        title: 'Report Type',
        body: 'Choose from three report types:\n\n- Loading & Inspection: Carried out as containers are loaded. Captures product grade, moisture readings, storage mode, container details, packaging content, and photos.\n- Quarterly PERN Inspection: A periodic site inspection. Includes a "Bale break performed?" toggle that reveals bale-break results and packaging-content checks when switched on.\n- PERN Audit: A comprehensive compliance audit with detailed site and process assessments.\n\nThe material being inspected is chosen from the Product Grade dropdown rather than being a separate report type.',
      },
      {
        title: 'Customer & Site',
        body: 'Select the customer and their inspection site from the dropdowns. If the customer or site doesn\'t exist yet, click the "+" button next to the dropdown to quickly add one without leaving the form. The "On Behalf Of" dropdown records the trading company the inspection is being carried out for (e.g. VISY, Genus, CTL): also add-able on the fly with its "+" button.',
      },
      {
        title: 'Inspection Details',
        body: 'Fill in the core inspection fields: date, time, inspector name, who the inspection is carried out on behalf of, and a quality score (1 = poor, 5 = excellent). Record moisture readings (low/high) and storage mode. For Loading & Inspection, also capture the loading reference, number of containers, and stock/bale count.',
      },
      {
        title: 'Unwanted Materials & Contaminants',
        body: 'Check any unwanted materials or contaminants found during the inspection. These options come from lookup values. You can add notes for any item, or use the "Other / Notes" box for items not in the list.',
      },
      {
        title: 'Containers',
        body: 'For Loading & Inspection reports you can track individual containers. Click "+ Add Container" to record the container number, seal number, and the load details: number of bales, weighbridge ticket, and weight. Photos can be associated with specific containers.',
      },
      {
        title: 'Assigning to an Inspector',
        body: 'Superusers can hand a report to another inspector. Fill in the header (date, site, contact, what is being inspected), pick the inspector in the "Assign To" dropdown, and use "Save & Assign". The inspector finds it under the "Assigned to me" filter, completes it on site, signs, and taps "Submit" to send it back marked Completed. Assigning is optional: leave it unassigned and complete the report yourself if you prefer.',
      },
      {
        title: 'PERN Audit Fields',
        body: 'PERN audit reports include extensive fields covering company details, site facilities, safety equipment, worker recording, PPE, accident logs, insurance, management experience, PRN expertise, packaging handling, training, and quality assessments.',
      },
      {
        title: 'Photos',
        body: 'Upload photos by clicking "Add Photos". You can optionally label each photo and, for Loading & Inspection reports, associate a photo with a specific container. Photos appear as thumbnails and can be removed individually.',
      },
      {
        title: 'Signature',
        body: 'Fill in the name and position of whoever is signing (the name defaults to the logged-in user, and both are printed beside the signature on the PDF), then use the signature pad to capture the signature itself. Click and drag (or use your finger on a touchscreen) to sign. Use the "Clear" button to start over.',
      },
      {
        title: 'Saving',
        body: 'Use "Save as Draft" to save work in progress. If you are handing the report to an inspector, choose them in "Assign To" and use "Save & Assign". The assigned inspector taps "Submit" once it is finished. To complete a report yourself, use "Save & Complete". "Cancel" returns to the reports list without saving.',
      },
    ],
  },

  'collection-notes': {
    heading: 'Collection Notes',
    sections: [
      {
        title: 'Overview',
        body: 'The Collection Notes page lists all collection notes in reverse date order, showing the reference, date, customer, item summary, and transport company at a glance. Every note carries a unique SBM reference (e.g. SBM1061), replacing the Word documents the office used to fill in by hand.',
      },
      {
        title: 'Creating a Collection Note',
        body: 'Click the "+ New Collection Note" button to raise a new note for material being picked up. You will be taken to the collection note form.',
      },
      {
        title: 'Searching and Filtering',
        body: 'Use the search box to find notes by reference, customer, or item description. Use the customer dropdown to narrow the list to a single customer.',
      },
      {
        title: 'Sorting',
        body: 'Click the Reference, Date, or Customer column heading to sort by that column; click again to reverse the order. Notes are sorted by collection date (newest first) by default.',
      },
      {
        title: 'Note Actions',
        body: "Each note row has actions:\n\n- Edit: Open the note for editing\n- Copy: Raise a fresh note carrying the same customer, items, and transport details, but with the next SBM reference and today's collection date. Useful when the same load goes out repeatedly; the copy never carries the original's signature.\n- PDF: Download the note as a formatted PDF, named for its reference, date, and customer\n- Delete: Permanently remove the note (you will be asked to confirm)",
      },
    ],
  },

  'collection-note-edit': {
    heading: 'Collection Note Form',
    sections: [
      {
        title: 'Overview',
        body: 'The collection note form is used to create and edit a collection note for material being picked up from a customer.',
      },
      {
        title: 'Reference',
        body: 'The SBM reference is filled in automatically when you start a new note, but you may overtype it if you need a specific reference.',
      },
      {
        title: 'Customer & Collection Address',
        body: "Choosing a customer fills in the collect-from address automatically. That address is then kept with the note, so it stays correct even if the customer's address changes later.",
      },
      {
        title: 'Items',
        body: 'Each line is given its own unique reference when the note is saved, shown at the top of the line: the note\'s reference with a number after it, such as SBM1061-1. It belongs to that line for good, so deleting a line never renumbers the others, and it is printed under the description on the PDF. List the items being collected, each with a quantity, description, nett weight in kilogrammes, your own item reference, and the registration of the vehicle carrying it. The description is chosen from the shared product description list, and the "+" button beside it adds a new description without leaving the form. Tick "Container" on a line that travels in a container, and boxes appear for the container number and seal number; untick it and those are forgotten. These appear on the PDF and in the item summary shown on the list page.',
      },
      {
        title: 'Sale (superusers only)',
        body: 'The "Sale (not shown on the note)" section holds the buyer, the buy price and the sale price. Only a superuser sees it, and none of it is printed on the PDF, which travels with the load; a save by anyone else leaves what is already there untouched. Whatever is entered here feeds the Sales page, where the sale is ticked off once it has been paid.',
      },
      {
        title: 'Signature',
        body: 'The goods dispatched signature may be captured on screen using the signature pad, or left blank if the note is to be signed on paper instead. There is no goods received signature: the note travels with the load and never comes back.',
      },
    ],
  },

  travel: {
    heading: 'Travel & Mileage',
    sections: [
      {
        title: 'Overview',
        body: 'The Travel page holds one mileage sheet per person per month. Pick a month and year and use "Open sheet" to start one, or to go back into the one you already have: there is only ever a single sheet for a given month, so opening it twice does not create a duplicate.',
      },
      {
        title: 'What the list shows',
        body: 'Each row shows the month, the number of journeys, the total miles, and the amount claimed, newest month first. A superuser also sees a "Person" column and a filter to switch between their own sheets, everyone\u2019s, or one particular person\u2019s.',
      },
      {
        title: 'Rates and the 10,000 mile band',
        body: 'Mileage is paid at the higher rate (55p by default) for the first 10,000 miles of the tax year, which runs from 6 April to 5 April, and at the lower rate (25p) thereafter. The band is worked out per person across the whole tax year, so a sheet is priced against the miles already claimed on earlier months. A superuser can change both rates and the band on the Lookups page.',
      },
      {
        title: 'Actions',
        body: 'Each row has actions:\n\n- Edit: open the sheet and enter journeys\n- PDF: download the sheet as a formatted PDF on the company letterhead\n- Delete: permanently remove the sheet and its journeys (you will be asked to confirm)',
      },
    ],
  },

  'travel-edit': {
    heading: 'Travel Sheet',
    sections: [
      {
        title: 'Entering journeys',
        body: 'Each leg of each trip gets its own row: the date, what the job was, where you went from and to, the customer if the journey was for one, and the miles. Use "+ Add journey" for another row, and "Remove" to take one out.',
      },
      {
        title: 'Round trips',
        body: 'Tick "Round trip" and enter the one-way mileage: the sheet doubles it for you, both in the totals and on the PDF. For a multi-leg run, enter each leg as its own row rather than ticking round trip.',
      },
      {
        title: 'Customers',
        body: 'The customer is chosen from the customer list, and the "+" button beside it adds a new customer without leaving the form. The name is stored on the journey as well as the link, so renaming a customer later does not rewrite your old sheets.',
      },
      {
        title: 'Totals',
        body: 'The totals under the table update as you type, showing the miles brought forward from earlier in the tax year, the miles at each rate, and the payment due. Nothing is stored until you press Save.',
      },
    ],
  },

  expenses: {
    heading: 'Expenses',
    sections: [
      {
        title: 'Overview',
        body: 'The Expenses page holds one expenses sheet per person per month. Pick a month and year and use "Open sheet" to start one, or to go back into the one you already have.',
      },
      {
        title: 'What the list shows',
        body: 'Each row shows the month, the number of items, the total spent, the VAT included in that total, and the net figure, newest month first. A superuser also sees a "Person" column and a filter to switch between their own sheets, everyone\u2019s, or one particular person\u2019s.',
      },
      {
        title: 'Actions',
        body: 'Each row has actions:\n\n- Edit: open the sheet, enter items and attach receipts\n- PDF: download the sheet as a formatted PDF, with the receipt photographs at the bottom\n- Delete: permanently remove the sheet, its items and its receipts (you will be asked to confirm)',
      },
    ],
  },

  'expense-edit': {
    heading: 'Expenses Sheet',
    sections: [
      {
        title: 'Entering expenses',
        body: 'Each item gets a row: the date, what it was, and what it cost. Use "+ Add expense" for another row, and "Remove" to take one out.',
      },
      {
        title: 'VAT',
        body: 'Tick "VAT?" where VAT can be reclaimed, then either type the VAT shown on the receipt or press the "20%" button to work it out of the cost at the standard rate. The totals split the VAT out, and switching an item back to no VAT clears the figure.',
      },
      {
        title: 'Receipts',
        body: 'Choose a file to add a photograph of a receipt. A receipt can be attached to a particular item, which captions it on the PDF, or left against the whole sheet. Saving happens automatically before the upload, since a receipt is attached to a saved item. Deleting an item leaves its receipts on the sheet rather than taking them with it.',
      },
      {
        title: 'Saving',
        body: 'The totals under the table update as you type, but nothing is stored until you press Save.',
      },
    ],
  },

  customers: {
    heading: 'Customers',
    sections: [
      {
        title: 'Overview',
        body: 'The Customers page lets you manage your customer list and their inspection sites. Customers are the companies whose materials you inspect.',
      },
      {
        title: 'Adding a Customer',
        body: 'Click "+ New Customer" and fill in the customer details. Only the customer name is required. You can also add a contact name, email, phone number, and address.',
      },
      {
        title: 'Editing a Customer',
        body: 'Click the "Edit" button next to any customer to update their details. The form will appear at the top of the page pre-filled with the current information.',
      },
      {
        title: 'Deactivating a Customer',
        body: 'Rather than deleting customers (which could affect existing reports), you can deactivate them. Deactivated customers won\'t appear in dropdown lists when creating new reports, but their existing reports are preserved. Click "Activate" to restore them.',
      },
      {
        title: 'Managing Sites',
        body: 'Click on a customer in the list to view and manage their sites in the right panel. Each customer can have multiple inspection sites (addresses). Type a new site address and click "Add" or press Enter. You can edit or deactivate sites just like customers.',
      },
      {
        title: 'Quick Add from Reports',
        body: 'You can also add new customers directly from the report form using the "+" button next to the Customer dropdown, without navigating away.',
      },
    ],
  },

  users: {
    heading: 'Users',
    sections: [
      {
        title: 'Overview',
        body: 'The Users page is available to superusers only. It lets you manage user accounts for the application.',
      },
      {
        title: 'Adding a User',
        body: 'Click "+ New User" and fill in the username, display name, and password. Optionally check "Superuser" to grant admin access. All fields except superuser status are required for new users.',
      },
      {
        title: 'Editing a User',
        body: 'Click "Edit" next to any user to change their details. When editing, leave the password field blank to keep the current password, or enter a new one to change it.',
      },
      {
        title: 'Superuser Access',
        body: 'Superusers can access the Users management page and have full administrative control. Regular users can create and manage reports, customers, and lookups, but cannot manage other user accounts.',
      },
      {
        title: 'Deactivating a User',
        body: 'Click "Deactivate" to prevent a user from logging in. Their account and associated reports are preserved. Click "Activate" to restore access.',
      },
    ],
  },

  lookups: {
    heading: 'Lookup Values',
    sections: [
      {
        title: 'Overview',
        body: 'Lookup values populate the dropdown lists and checkbox options used throughout the report form. Keeping these up to date ensures inspectors can quickly select the right options.',
      },
      {
        title: 'Lookup Categories',
        body: "The lookup categories are:\n\n- Product Descriptions: The types of materials being inspected\n- Product Grades: Quality grades for materials\n- Storage Modes: How materials are stored (e.g. baled, loose)\n- Unwanted Materials: Materials that shouldn't be present\n- Contaminants: Contaminating substances found during inspection\n- Clients (On Behalf Of): The trading companies inspections are carried out for",
      },
      {
        title: 'Report Type Association',
        body: 'Some lookup values are associated with a specific report type (Loading & Inspection or Quarterly PERN), so the options shown in the report form change with the selected type. Storage Modes and Clients (On Behalf Of) are shared across all types.',
      },
      {
        title: 'Adding a Value',
        body: 'Type the new value in the text field, select the report type if applicable, and click "Add" or press Enter.',
      },
      {
        title: 'Editing a Value',
        body: 'Click "Edit" next to any value to change its text. Press Enter or click "Save" to confirm, or "Cancel" to discard changes.',
      },
      {
        title: 'Deactivating a Value',
        body: 'Click "Deactivate" to hide a value from dropdown lists without deleting it. Existing reports that use the value are not affected. Click "Activate" to restore it.',
      },
      {
        title: 'Collection Notes (superusers only)',
        body: 'A "Collection Notes" card at the top of this page lets a superuser set the number for the next new collection note reference (e.g. the 1061 in SBM1061). Use it to carry the sequence on from numbers already used outside the app. Creating a note always advances the stored number automatically, so it will not go backwards on its own, but a superuser can still set it to any positive whole number by hand here.',
      },
    ],
  },

  sales: {
    heading: 'Sales',
    sections: [
      {
        title: 'Overview',
        body: 'The Sales page lists one line per consignment, newest collection date first, and shows the reference, date, customer, buyer, buy price and sale price. It is fed by the collection notes themselves rather than entered separately: raise a note, fill in its Sale section, and the line appears here. Superusers only, since every line carries the prices.',
      },
      {
        title: 'Marking a Sale Paid',
        body: 'Tick the box in the Paid column once the money has arrived and the line drops off the list. The date it was ticked is recorded, and the tick can be taken off again if it was a mistake. Both are written to the audit log.',
      },
      {
        title: 'What the List Shows',
        body: 'The list shows the unpaid sales by default, which is the point of the screen: what is still owed. Use the dropdown to show the paid ones instead, or all of them. "Outstanding" at the top right totals the sale prices of everything not yet ticked. "Open" takes you to the collection note behind a line.',
      },
    ],
  },

  audit: {
    heading: 'Audit Log',
    sections: [
      {
        title: 'Overview',
        body: 'The Audit Log is available to superusers only, and records who did what: reports, collection notes, customers, users, lookups and sheets created, changed or deleted, settings changed, backups taken and restored, and logins, logouts and failed login attempts. The newest entries are listed first.',
      },
      {
        title: 'What an Entry Says',
        body: 'Each entry records when it happened, who did it, the action, the kind of record and a short description written at the time. The description is deliberately a snapshot, so an entry for a deleted report still says which report it was even though the report has gone, and an entry still names the person who did it after their account has been renamed or removed.',
      },
      {
        title: 'Finding Something',
        body: 'Filter by person, action, kind of record or date range, or type in the search box to match the description or the person. The dropdowns offer only the values that actually appear in the log. Changing any filter takes you back to the first page.',
      },
      {
        title: 'What It Is Not',
        body: 'This is plain history for answering questions such as "where did that report go?". It is not tamper proof: a superuser with access to the server could alter it, and passwords are never recorded, only the fact that one was changed.',
      },
    ],
  },
  backups: {
    heading: 'Backups',
    sections: [
      {
        title: 'Overview',
        body: 'The Backups page is available to superusers only. It lists the backup archives the application has taken, lets you take one on demand, and lets you restore or download any of them.',
      },
      {
        title: 'Schedule',
        body: 'A backup is taken automatically once a day at the configured hour. Turn it off, change the hour, or change how many archives are kept with the schedule controls. The most recent archives (of each kind) are always kept; older ones are pruned automatically.',
      },
      {
        title: 'Taking a Backup Now',
        body: 'Click "Take backup now" to create an archive immediately, in addition to the scheduled ones.',
      },
      {
        title: 'Restoring',
        body: 'Restoring replaces all current reports, collection notes, customers and photos with the contents of the chosen archive. A snapshot of the current data is taken automatically before the swap, so a restore can itself be undone by restoring that snapshot. You must type RESTORE to confirm, since this is destructive. The application restarts as part of a restore, and you will be returned to the login page once it is back.',
      },
      {
        title: 'Uploading a Backup to Restore',
        body: 'Use "Upload and restore" to restore from an archive downloaded earlier, for example after moving to new hardware. The archive is validated before anything is changed; an archive that does not match this version\'s database structure is rejected.',
      },
      {
        title: 'Downloading and Deleting',
        body: 'Click "Download" to save an archive off the server, for an off-box copy. Click "Delete" to remove an archive you no longer need; this only removes the archive file, not the data it contains.',
      },
    ],
  },
};

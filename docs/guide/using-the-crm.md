# Using the CRM

This is the user guide for the CRM. The same words open inside the app:
choose **Help** in your account menu, press ⌘K and type what you want to do,
or follow a **How?** link next to a job's next step.

The guide has three parts. [What this service is](#what-this-service-is)
explains the ideas. [Start here](#start-here) walks a new owner through a
first job, from the first call to paid and closed. [How to do a task](#how-to-do-a-task)
has one short section for each thing you might want to do.

## What this service is
<!-- help: id=what-this-service-is; roles=owner,admin,agent; kind=about; keywords=overview, concepts, roles, lead, job, client, lifecycle -->

This CRM runs the work of a small residential contractor, one job at a time,
from the first call to the last payment.

### The client, the lead and the job

- The **client** is the person you do the work for. Clients never sign in.
- A **lead** is a person who might become a client: someone who called,
  filled in your website form, or was referred. A lead holds their name,
  how to reach them, and what they asked about.
- A **job** is one piece of work for a lead, at one address. The job is the
  hub: its tasks, appointments, notes, files, estimates, invoices and
  payments all hang off it. One lead can have many jobs, so a repeat client
  keeps one record.

### How a job moves

Every job shows a **Next step**: the one thing that has to happen for it to
move forward, with the button that does it. A job goes through five phases:

- **Selling**: New, Contacted, Appointment Scheduled, Proposal Sent. You
  visit, price the work and send an estimate.
- **Production**: Sold, Work Scheduled, In Progress. The client approved;
  you take a deposit, schedule the crew and do the work.
- **Billing**: Work Complete. You send the final invoice, which subtracts
  the deposit, and collect the balance.
- **Closed**: paid in full. The job closes by itself when the last payment
  clears the balance.
- **Lost**: the client went another way. A lost job can be reopened.

Money is a ledger. An invoice's balance is its total less the payments
recorded against it, and its status (Sent, Partially Paid, Paid, Overdue)
follows from that. A draft invoice does not count as owed until it is sent.

### Who does what

There are three staff roles:

- **Owner**: the person who created the company. Sees and can do everything,
  including changing other owners.
- **Admin**: sees every record and can do what an owner does, except change
  an owner.
- **Agent**: a salesperson or crew lead. Sees the leads, jobs and tasks
  assigned to them or that they created and nobody else holds, and the
  estimates and invoices on those jobs. Agents do not see Team, Templates,
  Automation or Integrations, cannot share the customer portal, and cannot
  remove a recorded payment or reopen a closed job.

### What the client can do without an account

The client gets links, never a login:

- **The shared estimate**: they read the scope and the total and choose
  Accept, Request revision or Decline.
- **The shared invoice**: they see what it covers, any deposit already
  billed, what they have paid and the amount due.
- **The customer portal**: one page per job with the project's progress, the
  estimates and invoices you sent, the payments, and the photos you chose to
  share.
- **The website form**: a "Request a quote" page that turns into a new lead.

Each link works until you make a new one for the same document.

## Start here
<!-- help: id=start-here; roles=owner,admin; kind=start; screen=/dashboard; screen-label=Today; keywords=first job, getting started, walkthrough, tutorial, new company, set up -->

This walks one job from the first call to paid and closed, on a company with
nothing in it yet. Do it once with a pretend client (use your own email or
phone) and every later job will feel familiar. It takes about fifteen
minutes. You need to be the owner or an admin.

### 1. Sign in

1. Open the CRM and sign in with your email and password. If you are
   starting a company, choose **Create a company**, fill in **Company name**,
   your name, email and a password, and choose **Create company**.
2. You land on **Today**. On a new company it says "Nothing needs you right
   now. Clear desk."

### 2. Create a lead

1. Choose **Create** at the top of the sidebar (on a phone, the **+** in the
   middle of the bottom bar), then **Lead**.
2. Fill in **First name** and **Last name**, and a **Phone** or **Email**.
3. Choose **Create lead**.

You are on the lead's page, with the name as the title and the status
**New**.

### 3. Turn it into a job

1. On the lead's page, choose **New job**.
2. The **Lead** is already filled in. Give the job a **Title** ("Roof
   replacement") and an **Address**.
3. Choose **Create job**.

You are on the job. Its status is **New** and the **Next step** says
**Schedule a site visit**.

### 4. Add a task and an appointment

1. Open the job's **Work** tab and choose **New task**. Give it a **Title**
   ("Call to confirm the visit") and a **Due date**, then choose **Create
   task**. It appears in the job's task list.
2. Choose **Schedule** on the same tab. The form switches to
   **Appointment** and is titled "Site visit". Pick when it **Starts**,
   leave **Set job status to Appointment Scheduled** ticked, and choose
   **Schedule appointment**.

The appointment shows in the list marked **Appointment**, the job moves to
**Appointment Scheduled**, and the next step becomes **Build the estimate**.

### 5. Write a note

1. Open the job's **Overview** tab and find **Communication**.
2. Pick what happened (**Call**, **Text**, **Email**, **In person** or
   **Note**), write a **Summary**, and choose **Log**.

The entry appears under the form with your name. Notes stay inside the
company: the client never sees them.

### 6. Add a file

1. Open the job's **Files** tab and choose **Upload files** (or drop files
   on the tab).
2. Pick a photo.

The file appears in the list. **Show in portal** is ticked, so the client
will see it on the portal; untick it to keep it internal.

### 7. Write the estimate

1. Choose **New estimate** on the job's next step.
2. Give it a **Title** and, if you like, **Notes for the client** (the
   client reads these). Choose **Create estimate**.
3. On the estimate, under **Scope**, choose **Add line**. Fill in **Item
   name**, **Quantity** and **Unit price**, and choose **Add line** again.
   Add as many lines as the job needs.

The total updates as you add lines, and the estimate's next step says
**Send it to the client**.

### 8. Send it

1. On the estimate's next step, choose **Send — copy link**.
2. Paste the link into a text or email to the client.

The estimate becomes **Sent**, the job moves to **Proposal Sent**, and the
job's next step says **Waiting on the client**.

### 9. Accept it the way the client does

1. Open the link you copied in a private browser window. This is the
   **shared estimate**: the client sees your company, the line items, the
   total and your notes, with no sign-in.
2. Choose **Accept**.

The page says "Thank you — this estimate is marked as accepted." Back in the
CRM, nobody touched the job and it is **Sold**. Its next step says **Request
a deposit**.

### 10. Request the deposit

1. On the job, choose **Request deposit** on the next step. The estimate
   opens beside the job with the deposit ready.
2. Set **Deposit %** (30 is filled in) and choose **Create deposit invoice**.
3. The deposit invoice opens in its place. Its next step says **Send it to
   the client**. Choose **Copy link** and send the link to the client.

The invoice is **Sent**, and the job's next step says **Schedule the work**
with the deposit still due. The client's link opens the **shared invoice**:
what it covers, the amount due, and payments received.

### 11. Record the deposit payment

1. On the job, open **Money** and choose the deposit invoice, or reopen it
   from the next step.
2. Choose **Record payment**. The **Amount** is the balance. Pick the
   **Method** (check, card, cash…), add a **Reference** such as the check
   number, and choose **Save payment**.

The invoice says **Paid in full**.

### 12. Schedule the work

1. On the job's next step, choose **Schedule**. The appointment form opens
   on the **Work** tab with **Set job status to Work Scheduled** ticked.
2. Pick when the work **Starts** and choose **Schedule appointment**.

The job is **Work Scheduled** and the next step says **Start the work**.

### 13. Show the client the portal

1. On the job, find **Customer portal** in the details panel on the right
   (on a phone, choose **Details**).
2. Choose **Copy portal link** and send it to the client.

The portal shows the project's progress, the estimate, the deposit invoice
and payment, and the photo you left visible. Drafts never show.

### 14. Do the work

1. When the crew starts, choose **Move to In Progress** on the next step.
2. When the work is done, choose **Move to Work Complete**.

The job is in billing. The next step says **Send the final invoice** with
the amount not yet invoiced.

### 15. Create and send the final invoice

1. Choose **Create final invoice** on the next step. The invoice opens
   beside the job and shows **Less deposit billed**, so the client is not
   billed twice.
2. On the invoice, choose **Copy link**. That sends it; give the link to the
   client.

The job's next step says **Collect** and the balance.

### 16. Record the final payment and see the job close

1. Choose **Record payment** on the job's next step, then **Save payment**.

The CRM says "Paid in full. The job is settled and closed." The job's status
is **Closed** and the next step is gone. The **Money** tab shows the contract,
what was collected, and a **Balance due** of $0.00.

That is the whole loop. Every later job runs the same way: follow the next
step.

## How to do a task
<!-- help: none -->

Each section stands on its own. It says who can do it, where, the steps, and
what you should see when it worked.

### Create a lead
<!-- help: id=create-a-lead; roles=owner,admin,agent; group=Leads and jobs; screen=/leads/new; screen-label=New lead; keywords=add a lead, new contact, new client, enquiry, prospect -->

**Who can do this:** Owner, admin, agent.

**Where:** Create, then Lead (also **New lead** on the Leads list).

1. Choose **Create**, then **Lead**.
2. Fill in **First name** and **Last name**, and a **Phone** or **Email**.
   **Source**, **Service**, **Urgency** and the budget are optional.
3. Choose **Create lead**.

**When it worked:** the lead's page opens with the status **New**. An agent's
new lead is assigned to them.

### Take leads from your website
<!-- help: id=take-leads-from-your-website; roles=owner,admin; group=Leads and jobs; screen=/integrations; screen-label=Integrations; keywords=intake form, website form, request a quote, web leads -->

**Who can do this:** Owner, admin.

**Where:** Integrations, under **Website intake**.

1. Open **Integrations** and choose **Generate link** under **Website
   intake**. The link is copied.
2. Put the link behind a "Request a quote" button on your website.

**When it worked:** the link opens a **Request a quote** form. Each form a
visitor sends becomes a **New** lead with the source **Website**.
**Regenerate** makes a new link and the old one stops working.

### Turn a lead into a job
<!-- help: id=turn-a-lead-into-a-job; roles=owner,admin,agent; group=Leads and jobs; screen=/leads; screen-label=Leads; keywords=convert, new job, opportunity, create job -->

**Who can do this:** Owner, admin, agent (on leads they can see).

**Where:** the lead's page.

1. Open the lead and choose **New job**.
2. Give the job a **Title** and an **Address**. The **Lead** is filled in.
3. Choose **Create job**.

**When it worked:** the job opens with the status **New** and the next step
**Schedule a site visit**. The job is listed under the lead's **Jobs** tab.

### Move a job through its stages
<!-- help: id=move-a-job-through-its-stages; roles=owner,admin,agent; group=Leads and jobs; screen=/jobs; screen-label=Jobs; keywords=status, phase, in progress, work complete, mark lost, reopen, pipeline -->

**Who can do this:** Owner, admin, agent. Only an owner or admin can reopen
a closed job.

**Where:** the job's **Overview** tab, under **Lifecycle**, and the job's
**Next step**.

1. To take the next stage, use the next step's button, such as **Move to In
   Progress** or **Move to Work Complete**.
2. To jump to another stage, choose it under **Lifecycle**. Skipping ahead
   asks you to confirm.
3. If the client went elsewhere, choose **Mark lost**, say **Why was it
   lost?**, and confirm. A lost job can be moved back into selling.

**When it worked:** the stage you chose is highlighted and the next step
changes. A job cannot close while money is still open; the CRM lists what
is blocking it.

### Add a task
<!-- help: id=add-a-task; roles=owner,admin,agent; group=Leads and jobs; screen=/tasks/new; screen-label=New task; keywords=to do, follow up, reminder, call back -->

**Who can do this:** Owner, admin, agent. An agent can assign tasks only to
themselves.

**Where:** the job's **Work** tab (**New task**), or Create, then Task.

1. On the job's **Work** tab, choose **New task**.
2. Give it a **Title** and a **Due date**.
3. Choose **Create task**.

**When it worked:** the task is in the job's list and on **Tasks**. When it
is due it shows on Today. **Mark completed** finishes it.

### Schedule an appointment
<!-- help: id=schedule-an-appointment; roles=owner,admin,agent; group=Leads and jobs; screen=/tasks/new?kind=appointment; screen-label=New appointment; keywords=site visit, meeting, calendar, book, visit -->

**Who can do this:** Owner, admin, agent.

**Where:** the job's **Work** tab (**Schedule**), or Create, then
Appointment.

1. On the job's **Work** tab, choose **Schedule**.
2. Pick when it **Starts**. **Ends** and **Location** are optional.
3. On a new job, leave **Set job status to Appointment Scheduled** ticked.
4. Choose **Schedule appointment**.

**When it worked:** the appointment is in the job's list marked
**Appointment**, it is on the **Tasks** calendar and on Today's **Agenda**,
and a new job moves to **Appointment Scheduled**.

### Schedule the work
<!-- help: id=schedule-the-work; roles=owner,admin,agent; group=Leads and jobs; screen=/jobs; screen-label=Jobs; keywords=crew, install date, production, book the job -->

**Who can do this:** Owner, admin, agent.

**Where:** the job's **Next step**, once the job is **Sold**.

1. Choose **Schedule** on the next step. The appointment form opens on the
   **Work** tab.
2. Pick when the work **Starts**, leave **Set job status to Work Scheduled**
   ticked, and choose **Schedule appointment**.

**When it worked:** the job is **Work Scheduled** and the next step says
**Start the work** with the visit's date.

### Log a call or a note
<!-- help: id=log-a-call-or-a-note; roles=owner,admin,agent; group=Notes and files; screen=/jobs; screen-label=Jobs; keywords=conversation, communication, call log, text, email, note, history -->

**Who can do this:** Owner, admin, agent.

**Where:** **Communication** on a job's or lead's **Overview** tab. The
preview beside a list has a shorter **Conversation** box.

1. Pick what happened: **Call**, **Text**, **Email**, **In person** or
   **Note**, and whether it was inbound or outbound.
2. Write the **Summary**. Add a **Follow-up** date if you need a reminder.
3. Choose **Log**.

**When it worked:** the entry appears under the form with your name and the
time. A follow-up date also creates a task. Notes are for the company only;
the client never sees them.

### Add files and photos
<!-- help: id=add-files-and-photos; roles=owner,admin,agent; group=Notes and files; screen=/files; screen-label=Files; keywords=upload, photo, picture, document, attachment, before after -->

**Who can do this:** Owner, admin, agent. Only an owner or admin can delete
a file.

**Where:** the job's **Files** tab.

1. Choose **Upload files**, or drop files on the tab. On a phone this can
   open the camera.
2. Add a **Caption** and pick **Before**, **After** or **Other** if you
   like.

**When it worked:** the file is in the job's list and on **Files**.

### Choose what the client sees
<!-- help: id=choose-what-the-client-sees; roles=owner,admin,agent; group=Notes and files; screen=/jobs; screen-label=Jobs; keywords=client visible, portal, private, internal, hide photo, show in portal -->

**Who can do this:** Owner, admin, agent.

**Where:** the job's **Files** tab, and the notes on estimates and invoices.

The client sees only what you send or share:

- **Files**: a file shows on the portal while **Show in portal** is ticked.
  Untick it to keep a photo internal.
- **Notes on a job or lead** (Communication): never shown to the client.
- **Notes for the client** on an estimate or invoice: shown on the shared
  page and the PDF.
- **Estimates and invoices**: shown once sent. Drafts and void invoices are
  never shown.
- **Payments**: the amount, method and date show; the **Internal note** on a
  payment does not.

**When it worked:** the portal shows only the files left ticked.

### Share the customer portal
<!-- help: id=share-the-customer-portal; roles=owner,admin; group=Notes and files; screen=/jobs; screen-label=Jobs; keywords=portal link, client page, customer page, progress page -->

**Who can do this:** Owner, admin.

**Where:** **Customer portal** in the job's details panel.

1. Open the job. On a phone, choose **Details**.
2. Under **Customer portal**, choose **Copy portal link**, or **Copy
   message** for a ready-to-send note with the link in it.
3. Send it to the client.

**When it worked:** the link opens the client's **Customer portal**: the
project's progress, the estimates and invoices you sent, the payments and
the balance, and the shared photos.

### Write an estimate
<!-- help: id=write-an-estimate; roles=owner,admin,agent; group=Estimates; screen=/estimates/new; screen-label=New estimate; keywords=quote, proposal, price, bid, line items, scope -->

**Who can do this:** Owner, admin, agent (on jobs they can see).

**Where:** the job's **Next step** (**New estimate**), or Create, then
Estimate.

1. Choose **New estimate**. The **Job** is filled in.
2. Give it a **Title** and any **Notes for the client**. To start from a
   saved package, pick a **Template (optional)**.
3. Choose **Create estimate**.
4. Under **Scope**, choose **Add line**. Fill in **Item name**, **Quantity**
   and **Unit price**, and choose **Add line** again. Repeat for each line.

**When it worked:** the estimate is a **Draft** with its total in the
details panel, and its next step says **Send it to the client**.

### Send an estimate
<!-- help: id=send-an-estimate; roles=owner,admin,agent; group=Estimates; screen=/jobs; screen-label=Jobs; keywords=share estimate, send quote, estimate link, proposal sent -->

**Who can do this:** Owner, admin, agent.

**Where:** the estimate's **Next step**. The job's next step **Send
estimate** opens it.

1. Choose **Send — copy link**, or **Copy message** for a note with the link
   in it.
2. Send the link to the client.

**When it worked:** the estimate is **Sent**, the job moves to **Proposal
Sent**, and the job's next step says **Waiting on the client**. Each new link
replaces the old one; the old link stops working.

### Record the client's answer
<!-- help: id=record-the-clients-answer; roles=owner,admin,agent; group=Estimates; screen=/jobs; screen-label=Jobs; keywords=accept, approve, decline, reject, revision, client response, waiting on the client -->

**Who can do this:** Owner, admin, agent.

**Where:** the client answers on the shared estimate; you can answer for
them on the estimate.

The client opens the link and chooses **Accept**, **Request revision** or
**Decline**, with an optional note.

If they told you another way:

1. Open the estimate. If they said yes, choose **Yes, they approved** on its
   next step.
2. If they said no, open **More** and choose **Mark declined**.

If they asked for changes, change the lines and choose **Resend — new
link**.

**When it worked:** an accepted estimate is **Approved** and locked, and the
job moves to **Sold** by itself with the next step **Request a deposit**. A
declined estimate says **Declined — revise and resend**.

### Add a change order
<!-- help: id=add-a-change-order; roles=owner,admin,agent; group=Estimates; screen=/jobs; screen-label=Jobs; keywords=extra work, change scope, amend, add to contract -->

**Who can do this:** Owner, admin, agent.

**Where:** an approved estimate, under **More**.

An approved estimate is locked: it is what the client agreed to. Extra or
different work goes on a change order the client approves separately.

1. Open the approved estimate, open **More**, and choose **Add change
   order**.
2. Add its lines and send it like any estimate.

**When it worked:** the change order is a new estimate marked **Change
order**. When the client approves it, its total is added to the job's
contract.

### Build an estimate template
<!-- help: id=build-an-estimate-template; roles=owner,admin; group=Estimates; screen=/estimates/templates; screen-label=Templates; keywords=package, reuse lines, price list, standard scope -->

**Who can do this:** Owner, admin.

**Where:** **Templates** in the sidebar.

1. Choose **New template**, give it a name, and choose **Create template**.
2. With the template selected, add each line (**New item**, then **Add
   item**).

**When it worked:** the template is listed on the left. Anyone writing an
estimate can pick it under **Template (optional)**, or choose **Apply
template** on a draft estimate.

### Request a deposit
<!-- help: id=request-a-deposit; roles=owner,admin,agent; group=Money; screen=/jobs; screen-label=Jobs; keywords=deposit invoice, down payment, upfront, retainer -->

**Who can do this:** Owner, admin, agent.

**Where:** the job's **Next step** once the job is **Sold**.

1. Choose **Request deposit**. The approved estimate opens beside the job
   with the deposit ready.
2. Set **Deposit %** and choose **Create deposit invoice**.
3. The deposit invoice opens. Choose **Copy link** (or **Mark sent** if you
   gave it to the client another way).

**When it worked:** the deposit invoice is **Sent** and the job's next step
moves on to **Schedule the work**. The final invoice will subtract the
deposit.

### Send an invoice
<!-- help: id=send-an-invoice; roles=owner,admin,agent; group=Money; screen=/invoices; screen-label=Invoices; keywords=invoice link, bill the client, mark sent, share invoice -->

**Who can do this:** Owner, admin, agent.

**Where:** the invoice's **Next step**. The job's next step **Send INV-…**
opens it.

1. Choose **Copy link** and send the link to the client. Copying the link
   sends the invoice.
2. If you delivered it another way (printed, emailed as a PDF from **More**,
   then **Download PDF**), choose **Mark sent**.

**When it worked:** the invoice is **Sent** and counts toward what the
client owes. Its next step says **Collect** and the balance.

### Record a payment
<!-- help: id=record-a-payment; roles=owner,admin,agent; group=Money; screen=/invoices; screen-label=Invoices; keywords=pay, paid, check, cash, card, partial payment, collect, balance -->

**Who can do this:** Owner, admin, agent. Only an owner or admin can remove a
payment.

**Where:** the invoice's **Next step**. The job's next step **Record
payment** opens it.

1. Choose **Record payment**.
2. The **Amount** is the balance. For a partial payment, type what was paid.
3. Pick the **Method**, add a **Reference** (a check number) and, if you
   like, an **Internal note**.
4. Choose **Save payment**.

**When it worked:** the payment is listed under **Payments**. A partial
payment leaves the invoice **Partially Paid** with the rest still due; the
full balance makes it **Paid in full**. You cannot record more than the
balance.

### Create the final invoice
<!-- help: id=create-the-final-invoice; roles=owner,admin,agent; group=Money; screen=/jobs; screen-label=Jobs; keywords=final bill, last invoice, bill the rest, less deposit -->

**Who can do this:** Owner, admin, agent.

**Where:** the job's **Next step** once the job is **Work Complete**.

1. Choose **Create final invoice**.
2. Check the lines. Then send it: see [Send an invoice](#send-an-invoice).

**When it worked:** a draft final invoice opens beside the job. It bills the
approved scope and change orders and shows **Less deposit billed**, so the
deposit is not billed twice.

### Void an invoice
<!-- help: id=void-an-invoice; roles=owner,admin,agent; group=Money; screen=/invoices; screen-label=Invoices; keywords=cancel invoice, delete invoice, mistake, remove payment, correct -->

**Who can do this:** Owner, admin, agent. Only an owner or admin can remove
a payment.

**Where:** the invoice, under **More**.

1. Open the invoice and open **More**.
2. Choose **Void invoice** and confirm. Use **Delete invoice** only for a
   draft the client never saw.

An invoice with payments cannot be voided. An owner or admin removes the
payment first (**Remove** next to it under **Payments**); the balance goes
back up and a closed job reopens. A deposit the final invoice already
subtracts cannot be voided until the final is voided.

**When it worked:** the invoice says **Void**. It stays on record but no
longer counts toward what the client owes, and the portal stops showing it.

### Close a job
<!-- help: id=close-a-job; roles=owner,admin,agent; group=Money; screen=/jobs; screen-label=Jobs; keywords=finish, done, closed, paid and closed, settle -->

**Who can do this:** Owner, admin, agent. Only an owner or admin can reopen
a closed job.

**Where:** the job.

A job in billing closes by itself when a payment clears the last balance.
You do not need to do anything.

If it has nothing owed and did not close (for example, you settled for less
than the estimate), choose **Move to Closed** on its next step, or **Closed**
under **Lifecycle**.

**When it worked:** the job is **Closed** and has no next step. If money is
still open, the CRM refuses and says why, such as a draft invoice that has
not been sent.

### Use Today
<!-- help: id=use-today; roles=owner,admin,agent; group=Finding your work; screen=/dashboard; screen-label=Today; keywords=home, dashboard, what to do, agenda, needs you, customize -->

**Who can do this:** Owner, admin, agent.

**Where:** **Today** in the sidebar.

Today shows what needs you, in order:

- **Needs you**: late follow-ups, money to collect, jobs ready to bill or
  stuck, estimates waiting. Filter by **Late**, **Money**, **Waiting** or
  **Jobs & leads**.
- **Agenda**: today's and upcoming appointments and tasks.
- **Handoffs**: jobs sold but not scheduled, done but not billed, and
  estimates waiting on the client.

An owner or admin can switch between **Mine** and **Team**. Choose
**Customize** to hide, move or reorder the widgets.

**When it worked:** choosing an item opens it beside Today. An empty Today
says "Nothing needs you right now. Clear desk."

### Check your inbox
<!-- help: id=check-your-inbox; roles=owner,admin,agent; group=Finding your work; screen=/notifications; screen-label=Inbox; keywords=notifications, alerts, bell, unread -->

**Who can do this:** Owner, admin, agent.

**Where:** **Inbox** in the sidebar, or the bell at the top.

1. Open **Inbox**. Unread items come first.
2. Choose an item to open the record it is about. **Mark all read** clears
   the badge; **Clear read** removes what you have read.

**When it worked:** the bell's count goes down. You get an alert when work
is assigned to you and when a payment comes in on your job.

### Search
<!-- help: id=search; roles=owner,admin,agent; group=Finding your work; screen=/dashboard; screen-label=Today; keywords=find, command k, look up, filter, jump -->

**Who can do this:** Owner, admin, agent. Search finds only what you can
see.

**Where:** anywhere: press ⌘K (Ctrl K on Windows) or **/**, or choose the
search button.

1. Type a name, address, invoice number or title.
2. To narrow, type a filter such as `job:`, `status:Sold` or
   `assigned:me`.
3. Choose a result, or use the arrows and Enter.

**When it worked:** the record opens. On a record, search lists that record's
own leads, jobs and documents first. Search also finds the articles in this
guide by the task you type.

### Save a view
<!-- help: id=save-a-view; roles=owner,admin,agent; group=Finding your work; screen=/jobs; screen-label=Jobs; keywords=filter, saved filter, list view, columns, display -->

**Who can do this:** Owner, admin, agent. Your views are yours.

**Where:** the Jobs, Leads, Tasks and Invoices lists.

1. Filter the list the way you want. The filters are in the address, so a
   reload or a shared link keeps them.
2. Choose **Save view**, give it a **View name**, and save.
3. Choose **Pin view** to put it in the sidebar.

**When it worked:** the view is listed under **Saved views** and, if pinned,
in the sidebar. Changing a filter leaves the view; choosing it again
re-applies it. **Display** chooses the columns and sort of each list.

### Pin a record
<!-- help: id=pin-a-record; roles=owner,admin,agent; group=Finding your work; screen=/jobs; screen-label=Jobs; keywords=favorite, bookmark, sidebar, shortcut -->

**Who can do this:** Owner, admin, agent. Pins are yours.

**Where:** a record's page (**Pin**), or the pin button on its preview.

1. Open a job, lead, estimate or invoice.
2. Choose **Pin**.

**When it worked:** the button says **Pinned**, and the record is in the
sidebar and Today's **Pinned** widget. Choose **Pinned** again to unpin.
You can keep up to 20 pins.

### Read the reports
<!-- help: id=read-the-reports; roles=owner,admin,agent; group=Finding your work; screen=/reports; screen-label=Reports; keywords=analytics, revenue, collections, aging, win rate, team performance -->

**Who can do this:** Owner, admin, agent. An agent's reports cover their own
work; **Team performance** is for owners and admins.

**Where:** **Reports** in the sidebar.

1. Open **Reports**. It shows **Open jobs**, the **Lead funnel**, **Jobs by
   stage**, **Estimate outcomes**, **Monthly trends** and **Money after the
   sale** (outstanding, past due, collected, and aging).
2. An owner or admin can open **Team performance** for each person's wins,
   days to proposal and overdue work.

**When it worked:** the numbers fill in as estimates are approved, invoices
go out and payments come in. A new company shows "No money moved yet".

### Invite a teammate
<!-- help: id=invite-a-teammate; roles=owner,admin; group=Team and settings; screen=/users; screen-label=Team; keywords=add user, new employee, agent, admin, team member -->

**Who can do this:** Owner, admin. Only an owner can make another owner.

**Where:** your account menu (**Invite someone**), or **Team**.

1. Choose **Invite someone**.
2. Fill in **First name**, **Last name** and **Email**, pick **Agent** or
   **Admin**, and choose **Create invite**.
3. If the CRM cannot send email, choose **Copy link** and send the link
   yourself.

**When it worked:** the person is listed on **Team** as **Invited**. When they
open the link and set a password, they become **Active**. You can **Resend
invite** or **Revoke invite** from the person's row.

### What an agent sees
<!-- help: id=what-an-agent-sees; roles=owner,admin,agent; kind=reference; group=Team and settings; keywords=permissions, access, assigned, role, cannot see -->

**Who this is for:** Owner, admin, agent.

**Where:** everywhere the agent works.

An agent sees:

- leads, jobs and tasks assigned to them, or that they created and nobody
  else holds;
- the estimates and invoices on those jobs;
- their own Today, reports and search results.

An agent does not see **Team**, **Templates**, **Automation** or
**Integrations**, the **Money** and **Team load** widgets, or **Workspace**
settings. They cannot share the customer portal, delete files, remove a
payment, reopen a closed job, or assign work to someone else. An agent who
opens a record that is not theirs sees "not available" instead of empty
numbers.

To give an agent a job, an owner or admin opens **Jobs**, ticks the job's
box, and picks the agent under **Assign to…**.

### Set your preferences
<!-- help: id=set-your-preferences; roles=owner,admin,agent; group=Team and settings; screen=/settings; screen-label=Preferences; keywords=theme, dark mode, density, compact, sidebar, layout, reset -->

**Who can do this:** Owner, admin, agent. Your preferences are yours and
follow you to every device.

**Where:** your account menu, then **Preferences**.

1. **Appearance**: **Theme** (Light, Dark, Auto), **Accent palette**,
   **Density** (Comfortable or Compact) and **Reduce motion**. Theme and
   density are also in the account menu.
2. **Navigation**: the order of the sidebar and which items it shows.
3. **Today**: which widgets show and where.
4. **Lists & records**: the columns you chose for each list and how you
   arranged record pages. **Reset** puts one back.

**When it worked:** the change shows at once and is still there after a
reload or on your phone. Customers never see your personal look.

### Set workspace defaults
<!-- help: id=set-workspace-defaults; roles=owner,admin; group=Team and settings; screen=/settings?tab=workspace; screen-label=Workspace settings; keywords=team defaults, company logo, branding, company name, palette -->

**Who can do this:** Owner, admin.

**Where:** your account menu, then **Workspace settings**.

1. Under **Your company**, set the company name, mark and palette.
   Customers see these on the portal, estimates and invoices.
2. To give everyone your layout, pick the **Parts to share** and choose
   **Make my setup the team default**.
3. **Clear defaults** returns everyone to the standard workspace.

**When it worked:** "Team defaults saved." People who have not changed those
settings see your setup; their own changes are kept.

### Turn on an automation
<!-- help: id=turn-on-an-automation; roles=owner,admin; group=Team and settings; screen=/automation; screen-label=Automation; keywords=workflow, rules, automatic tasks, trigger -->

**Who can do this:** Owner, admin.

**Where:** **Automation** in the sidebar.

1. Under **Rule templates**, find a rule such as "Notify owner when a job is
   sold" or "Auto-create tasks when estimate approved".
2. Choose **Activate**.

**When it worked:** the rule is listed under **Active rules**. It runs the
next time its event happens. **Disable** pauses it; **Delete** removes it.

### Check ABC Supply and QuickBooks
<!-- help: id=check-abc-supply-and-quickbooks; roles=owner,admin; group=Team and settings; screen=/integrations; screen-label=Integrations; keywords=integration, accounting, supplier, sync, connect -->

**Who can do this:** Owner, admin.

**Where:** **Integrations**.

1. Open **Integrations**. **ABC Supply** and **QuickBooks Online** each show
   a status: **Not configured**, **Partial** or **Ready**.
2. Open either one to see which settings are present.

**When it worked:** you can see whether the connection is set up. Setting
one up needs account keys that whoever runs your CRM server adds; until
then the status stays **Not configured** and there is nothing to connect.

## Not in this guide
<!-- help: none -->

These are left out, with the reason. They are not in the panel.

- **Ordering from ABC Supply, pricing lookups.** Needs a live ABC Supply
  account and keys the server does not have. Without them the page shows
  only **Not configured**.
- **Connecting QuickBooks and Sync to QuickBooks.** Needs QuickBooks app
  keys and a QuickBooks company. **Sync to QuickBooks** appears on an invoice
  only once connected, so it could not be walked.
- **Emailed invites and reminders.** The CRM sends email only when the
  server has mail settings. Without them, **Create invite** shows a link to
  copy; that path is documented in [Invite a teammate](#invite-a-teammate).
- **Taking card payments online.** Not in the product. Payments are
  recorded by hand.
- **Measurements on a job.** The **Measurements** section exists on the job
  Overview but has no step in the job's flow; it was not walked for this
  guide.
- **Moving or completing several rows at once.** The list's bulk bar can
  do it, but only assigning was walked for this guide.

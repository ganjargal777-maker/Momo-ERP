# Employee invitation setup

For a local Supabase stack and ERP UI, set the Edge Function environment variable
`ERP_INVITE_REDIRECT_URL=http://localhost:4173/?setup=1` and serve the ERP at
`http://localhost:4173`. The checked-in local Auth configuration allows that
exact setup URL. Keep test email in the local mail sink.

When the variable is absent, invitations use the existing hosted callback
`https://erp.momoshop.mn/?setup=1`. An unrecognized value stops the invitation
before email is sent. The request body and Origin header cannot select the
destination of an invitation.

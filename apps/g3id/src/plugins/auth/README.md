# ID auth plugin

Sign-in and sign-up pages for ID. Routes include /login, /login/email, provider/error flows, /signup and /signup/pending. Navigation uses Sign in and Sign up.

The pages sign in through ID's worker (workers/g3id, /auth/*). Account, user management, permissions, kiosk management and attendance pages live in Gearbox Home. Existing ID URLs redirect there.

# ThoughtSpace

ThoughtSpace is a floating wall for sharing short thoughts. It includes search, date filters, likes, replies, and live updates.

Production domain: <https://thoughtspace.ct.ws>. Point that domain to the site's document root in the hosting panel and enable its SSL certificate before relying on the HTTPS URL.

The PHP API uses PDO prepared statements and utf8mb4 MySQL tables for notes, likes, replies, and live-sync revision tracking. It supports publishing, likes, replies, and server-sent live synchronization; the browser refreshes the shared note collection when a change is detected and also checks periodically as a fallback.

## Security notes

The wall is currently public: visitors can read notes and submit notes, likes, and replies. The PHP API validates request sizes and fields, rejects cross-origin browser writes, and stores data outside direct web access. These checks do not authenticate callers or prevent automated abuse; add an account or moderation policy before treating submissions as private or trusted. Use HTTPS in hosting settings.

Database values are sent through PDO prepared statements rather than interpolated into SQL. Keep credentials outside the public document root if the host permits it, and grant the database user access only to this app's tables.

Opening `index.html` directly with a `file:` URL uses browser-local storage and does not connect to the PHP API.

## Local PHP preview

With PHP CLI and the MySQL tables configured, run this from the project folder:

```sh
php -S localhost:8000 php-router.php
```

Then open <http://localhost:8000>. The Node server is also retained as an optional local development server (`npm start`).

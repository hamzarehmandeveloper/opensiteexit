# Security

OpenSiteExit loads arbitrary web pages in a headless browser and writes files
derived from them. If you run it as a service, treat the target URL as
untrusted input: restrict it to public hosts, run the crawler without access
to internal networks, and cap pages, time and disk per job.

To report a vulnerability, open a private security advisory on GitHub
(Security tab, "Report a vulnerability") rather than a public issue.

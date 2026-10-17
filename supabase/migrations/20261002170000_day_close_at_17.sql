select cron.alter_job((select jobid from cron.job where jobname = 'crm-day-close'), schedule := '0 15 * * *');

#!/usr/bin/env bash
awslocal s3 mb s3://admin
awslocal s3 mb s3://annotation-api
echo -n "" > my_file
awslocal s3 cp my_file s3://admin/my_file

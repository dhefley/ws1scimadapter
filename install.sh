#! /bin/sh

# Install Workspace ONE UEM SCIM Adapter to apps/ws1scim and set configuration parameters

# Declarations
DOWNLOADPATH="/home/bitnami/ws1_uem_scim_adapter_2008.ga"
INSTALLPATH="/opt/bitnami/apps/ws1scim"
FLINGNAME="ws1scim.tar.gz"
CONFIGPATH="config/plugin-airwatch.json"
LOGDIR="/var/log/ws1scim"
APACHEPATH="/opt/bitnami/apache2/conf"
RESTARTCTL="/opt/bitnami/ctlscript.sh"
LEGOCTL="/opt/bitnami/letsencrypt/scripts/generate-certificate.sh"
SYSDFILE="/lib/systemd/system/ws1scim.service"

# Service User
SERVICEACCOUNT="ws1scim"

# Binary locations
TARPATH="/bin/tar"
SEDPATH="/bin/sed"
MKDIRPATH="/bin/mkdir"
CHOWNPATH="/bin/chown"
CHMODPATH="/bin/chmod"
ADDUSERPATH="/usr/sbin/adduser"
NODEPATH="/opt/bitnami/nodejs/bin"
CURLPATH="/opt/bitnami/common/bin/curl"
CPPATH="/bin/cp"
SYSCTLPATH="/bin/systemctl"

# Check if being run as root
if [ `id|sed -e s/uid=//g -e s/\(.*//g` -ne 0 ]; then
    echo "You need to be root for this to work"
    exit 1
fi

# Create the service account
$ADDUSERPATH --system --no-create-home --shell /bin/bash --disabled-password --disabled-login --group $SERVICEACCOUNT

# Create install and log directories
echo "Creating directories at ${INSTALLPATH}"
$MKDIRPATH /opt/bitnami/apps
$MKDIRPATH /opt/bitnami/apps/ws1scim
echo "Creating log directory at ${LOGDIR}"
$MKDIRPATH $LOGDIR
$CHOWNPATH $SERVICEACCOUNT:$SERVICEACCOUNT $LOGDIR
$CHMODPATH 750 $LOGDIR

# Unpack files
echo "Unpacking files to ${INSTALLPATH}"
$TARPATH -zxf $DOWNLOADPATH/$FLINGNAME -C $INSTALLPATH

# Set configuration parameters
echo "Configuring Workspace ONE UEM SCIM Adapter"
while [ -n "$1" ]; do

    case "$1" in

    --host)
        APIHOST="$2"
        echo "Setting UEM API baseUrl to ${APIHOST}"
        $SEDPATH -i 's#your_api_server#'$APIHOST'#g' $INSTALLPATH/$CONFIGPATH
        shift
        ;;

    --api-key)
        APIKEY="$2"
        echo "Setting UEM API key"
        $SEDPATH -i 's#your_aw-tenant-code#'$APIKEY'#g' $INSTALLPATH/$CONFIGPATH
        shift
        ;;

    --port)
        SVCPORT="$2"
        echo "Setting listening port to ${SVCPORT}"
        $SEDPATH -i 's#9000#'$SVCPORT'#g' $INSTALLPATH/$CONFIGPATH
        shift
        ;;

    --serviceurl)
        SVCNAME="$2"
        echo "Setting your SCIM endpoint to ${SVCNAME}"
        shift
        ;;

    --email)
        EMAIL="$2"
        echo "Using ${EMAIL} for certificate request"
        shift
        ;;

    *) echo "Option $1 not recognized" ;;
    esac
    shift
done

# Go get certificate
$LEGOCTL -m $EMAIL -d $SVCNAME

# Setup Apache hosting
echo "Updating Apache configuration"

# Create the Apache config directory
$MKDIRPATH $INSTALLPATH/conf

# Setup HTTPS Redirect
echo "RewriteEngine On" >> $APACHEPATH/bitnami/bitnami-apps-prefix.conf
echo "RewriteCond %{HTTPS} !=on" >> $APACHEPATH/bitnami/bitnami-apps-prefix.conf
echo "RewriteCond %{HTTP_HOST} !^(localhost|127.0.0.1)" >> $APACHEPATH/bitnami/bitnami-apps-prefix.conf
echo "RewriteRule ^/(.*) https://%{SERVER_NAME}/$1 [R,L]" >> $APACHEPATH/bitnami/bitnami-apps-prefix.conf

# Create link files
echo "Include \"/opt/bitnami/apps/ws1scim/conf/httpd-app.conf\"" > $INSTALLPATH/conf/httpd-prefix.conf
echo "ProxyPass / http://127.0.0.1:${SVCPORT}/" > $INSTALLPATH/conf/httpd-app.conf
echo "ProxyPassReverse / http://127.0.0.1:${SVCPORT}/" >> $INSTALLPATH/conf/httpd-app.conf
echo "Include \"/opt/bitnami/apps/ws1scim/conf/httpd-prefix.conf\"" >> $APACHEPATH/bitnami/bitnami-apps-prefix.conf

# Restart Apache Server
echo "Configuration applied - restarting Apache server"
$RESTARTCTL restart apache

# Finalize service creation
echo "[Unit]" >> $SYSDFILE
echo "Description=index.js - ws1scim wrapper" >> $SYSDFILE
echo "Documentation=https://labs.vmware.com/flings/workspace-one-uem-scim-adapter" >> $SYSDFILE
echo "After=network.target" >> $SYSDFILE
echo "" >> $SYSDFILE
echo "[Service]" >> $SYSDFILE
echo "Type=simple" >> $SYSDFILE
echo "User=${SERVICEACCOUNT}" >> $SYSDFILE
echo "ExecStart=${NODEPATH}/node ${INSTALLPATH}/index.js" >> $SYSDFILE
echo "Restart=on-failure" >> $SYSDFILE
echo "StandardOutput=file:${LOGDIR}/ws1scim.log" >> $SYSDFILE
echo "StandardError=file:${LOGDIR}/ws1scim.log" >> $SYSDFILE
echo "" >> $SYSDFILE
echo "[Install]" >> $SYSDFILE
echo "WantedBy=multi-user.target" >> $SYSDFILE

$SYSCTLPATH daemon-reload

# Start Fling for testing and verification
echo "Starting up Workspace ONE SCIM Adapter for install verification"
$NODEPATH/forever start $INSTALLPATH/index.js

# Need to wait for services
echo "Pausing for 5 seconds while services initiate"
sleep 5

# Verify that applet is listening
echo "Requesting /ping to confirm service is alive"
TESTRESPONSE=$($CURLPATH -k https://localhost/ping)
echo "${TESTRESPONSE}"
if [ $TESTRESPONSE = "hello" ]; then
        echo "Everything checks out - shutting down temporary thread"
        $NODEPATH/forever stop $INSTALLPATH/index.js
        $SYSCTLPATH enable ws1scim && $SYSCTLPATH start ws1scim
        exit 0
else
        echo "Something went wrong - make sure Apache is up and listening for HTTPS with valid certificate"
        $NODEPATH/forever stop $INSTALLPATH/index.js
        exit 1
fi
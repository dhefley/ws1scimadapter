
# Workspace ONE UEM SCIM Adapter  

---  
Authors:
Matt Williams, VMware EUC Staff Architect
Joe Rainone, VMware EUC Consulting Architect

Latest Version: 20.8.1

Validated through IdP's:  

- Microsoft Azure Active Directory
- Okta (On Roadmap)

20.08 Release Notes:

**Please Note:** If you have already setup WS1 SCIM Adapter, it is possible that moving to 20.08 will create new accounts. Please consider resetting Directory Services configuation for the OG you are connecting to.

New Features:

- Deployments now exclusively supported on Docker. See install instructions for more details on how to orchestrate the deployment using the included Helm chart.

Bugs Fixed:

- createGroup returns unexpected error due to missing payload return

Other Notes:

- Bitnami deployment script introduced in 20.03 has been deprecated. Although it is still possible to deploy on Appliance form-factors, future development will be exclusively supported on Docker.

## Overview  
 
Workspace ONE UEM SCIM Adapter provides SCIM user/group management capabilities to Workspace ONE UEM. The middleware translates the System for Cross-Domain Identity Management, SCIM, to a CRUD REST framework that Workspace ONE UEM can interpret. This capability allows Workspace ONE UEM to synchronize cloud-based identity resources (users/groups/entitlements) without the need for an LDAP endpoint (service to service model). Examples include Azure AD, Okta, and Sailpoint.

![](https://labs.vmware.com/flings/files/uploads/0/0/0/0/2/6/7/ws1uemscim-screenshot.png)

## Prerequisites

#### Requirements

1. Node.js v7.6+ persistent runtime environment (consider using included Dockerfile for build)
2. Reverse proxy with SSL certificate (i.e. Apache, NGINX, HAproxy, etc)
  * The service does not accept SSL certificates and must be secured thru an SSL reverse proxy
  * Consider 60 minute timeouts depending on directory size
3. Connectivity from directory source (Okta, Azure AD, etc) to service over HTTPS 443
4. Workspace ONE UEM API information:
  * Base API URL
  * Customer OG tenant code (REST API key)
5. Workspace ONE UEM 1810 or higher
6. Resource object source anchors:
  * User -> CustomAttribute1 = ImmutableId (objectGUID or Ms-Ds-Consistency-Guid)
  * Group -> ExternalId = displayName
7. Workspace ONE UEM Directory Services -> 
  * 'Directory Type' must be set to 'None' at a minimum
  * 'Enable SAML Authentication For' set to 'Enrollment' at a minimum
  * Custom Attributes must be enabled, with 'Custom Attribute 1' set to type 'String'

#### Functions and Attributes

1. Not Enabled:
  * PATCH group modifications
  * Multi-group query pagination
  * Group membership query
  * Administrator account provisioning (On Roadmap)
  * Roles or Entitlements (On Roadmap)
2. Resource Attributes:

| Identity Provider                    	| SCIM Adapter 	    | Workspace ONE UEM 	| Comments                      |
|--------------------------------------	|------------------ |--------------------	|------------------------------ |
| UserPrincipalName                    	| UserName     	    | UserName          	| Non-Modifiable                |
| ObjectId                             	| ExternalId   	    | ExternalId        	| Non-Modifiable                |
| ImmutableId                           | ImmutableId       | CustomAttribute1    | Non-Modifiable                |
|                                       |                   | aadMappingAttribute | Non-Modifiable                |
| Emails type eq "Work"                	| Emails       	    | EmailAddress      	|                               |
|                                      	| Emails       	    | EmailUser         	|                               |
| GivenName                            	| GivenName    	    | FirstName         	|                               |
| FamilyName                           	| FamilyName   	    | LastName          	|                               |
| Formatted = {GivenName + FamilyName} 	| Formatted    	    | DisplayName       	|                               |
| Active = IsSfotDeleted               	| Active       	    | Status            	|                               |
| telephoneNumber                       | phoneNumbers.work | phoneNumber         |                               |
| department                            | department        | department          | Enterprise Schema             |
| employeeId                            | employeeNumber    | employeeIdentifier  | Enterprise Schema             |
| {configurable}                        | customAttribute2  | CustomAttribute2    | Custom Schema/Non-Modifiable  |
| {configurable}                        | customAttribute3  | CustomAttribute3    | Custom Schema/Non-Modifiable  |
| {configurable}                        | customAttribute4  | CustomAttribute4    | Custom Schema/Non-Modifiable  |
| {configurable}                        | customAttribute5  | CustomAttribute5    | Custom Schema/Non-Modifiable  |

## Deployment examples:

- **Kubernetes** - [Matt Williams](https://blog.virtualprivateer.com/ws1-uem-scim-adapter-2008)
- **Bitnami** - [Matt Williams](https://blog.virtualprivateer.com/2019/06/08/ws1-uem-scim-adapter/)
- **Photon** - [Camille Debay](https://debay.blog/2019/06/10/install-workspace-one-uem-scim-adapter-on-photon-os/)

## Installation

The following outlines deploying the SCIM adapter. For mainstream use, consider submitting the included Dockerfile to your build service/registry and deploying the adapter with the included Helm chart.

#### Kubernetes

The included Helm chart assumes you have deployed an Nginx ingress controller, Jetstack cert-manager and a cluster issuer. Amend the charts according to your Kubernetes environment.

```
helm install ws1scimadapter ./ws1scimadapter/
```

Use the values.yaml file included in the chart directory to configure the adapter. Values to consider:

- `image.repository` -> the hostname and directory reference to your container registry. Do not include the version label
- `airwatchHost` -> the hostname of your Workspace ONE UEM API virtual IP
- `airwatchApi` -> your Workspace ONE UEM API tenant code
- `cert-manager.io/cluster-issuer` -> the name/label of the cluster issuer in your Kubernetes cluster
- `hosts.host` -> the hostname of the virtual IP for your adapter service
- `tls.hosts` -> same as hosts.host and used for certificate generation

The remaining instructions are not needed for a Docker/Kubernetes deployment.

#### Install Node.js

Node.js is a prerequisite and must be installed on the server. Consider using a one-click container deployment, such as [Bitnami](https://bitnami.com/stack/nodejs/cloud)

Linux: Either build from source or download from your distirbution repo
Windows: [Download](https://nodejs.org/en/download/) the windows installer (.msi 64-bit) and install using default options.  

#### Install Workspace ONE UEM SCIM Adapter  

Create your own package directory e.g. /opt/ws1scim and copy the Adapter application within this `<package-root>`.
```
sudo mkdir /opt/ws1scim
cd /opt/ws1scim
sudo tar -zxvf <archivelocation>/ws1_uem_scim_adapter_2008_ga.tar.gz -C /opt/ws1scim/
```

#### Startup and verification
```
sudo node /opt/ws1scim/index.js
	
Start a web browser or use an appropriate CLI client (note, IE does not support JSON content)

curl -vv http://localhost:9000/ping
=> Health check with a "hello" response

"Ctrl + c" to stop the Adapter
```
You can use the `/ping` URI as a health check endpoint for load balancers and reverse proxies.

## Configuration  


Edit the **plugin-airwatch.json** configuration file according to your needs.  
Below shows an example of `/opt/ws1scim/config/plugin-airwatch.json`
```  
{
    "scimgateway": {
      "scimversion": "2.0",
      "loglevel": "debug",
      "localhostonly": false,
      "port": 9000,
      "auth": {
        "basic": {
          "username": null,
          "password": null
        },
        "bearer": {
          "token": null,
          "jwt": {
            "azure": {
              "tenantIdGUID": null
            },
            "standard": {
              "secret": null,
              "publicKey": null,
              "options": {
                "issuer": null
              }
            }
          }
        }
      },
      "certificate": {
        "key": null,
        "cert": null,
        "ca": null,
        "pfx": {
          "bundle": null,
          "password": null
        }
      },
      "emailOnError": {
        "smtp": {
          "enabled": false,
          "host": null,
          "port": 587,
          "proxy": null,
          "authenticate": true,
          "username": null,
          "password": null,
          "sendInterval": 15,
          "to": null,
          "cc": null
        }
      }
    },
    "endpoint": {
      "entity": {
        "undefined": {
          "baseUrl": "https://your_api_server/api",
          "username": null,
          "password": null,
          "tenantCode": "your_aw-tentant-code"
        }
      }
    }
  }
```

You should only need to edit the following configuration items within the `plugin-airwatch.json` file:

- **port** - The Adapter will listen on this port number.

- **loglevel** - error, info or debug. Output to logfile `/opt/ws1scim/logs/plugin-airwatch.log`   

- **endpoint** - Contains endpoint specific configuration according to our **plugin code**. Place your Workspace ONE UEM API base URL i.e. `https://cn135.awmdm.com/api` and UEM API Tenant Code `Groups and Settings -> All Settings -> System -> Advanced -> API -> REST API -> API Key` into the corresponding fields  
 
## Manual startup    

The Adapter can be started from a CLI running in administrative mode

`sudo node /opt/ws1scim/index.js`

<kbd>Ctrl</kbd>+<kbd>c</kbd> to stop  

## Automatic startup - Persistent

There are various flavors of Node.js persistent service tools. For example, you can start the Adapter persistently with `forever`:

```
cd /opt/ws1scim/
sudo forever start ./index.js
netstat -an | grep 9000
```

## Other Installation Steps

Undocumented here; you will need to deploy a reverse proxy hosting SSL, and `ProxyPass` to `localhost:9000`. All connections from the source system will be on the public namespace, HTTPS.
// =================================================================================
// File:    plugin-airwatch.js
//
// Author:  Matt Williams/Joe Rainone
//
// Purpose: AirWatch User and Group provisioning with RESTful API
//
// Prereq:  plugin-airwatch; AirWatch REST API configuration
//
// Supported attributes:
//
// Identity Provider          Scim                            Service Provider
// -----------------------------------------------------------------------------------------------
// userPrincipalName          userName                        userName
// ObjectId                   externalId                      externalId
// ImmutableId                immutableId                     customAttribute1
//                                                            aadMappingAttribute
// mail                       emails.work                     emailAddress
//                                                            emailUserName
// givenName                  givenName                       firstName
// familyName                 familyName                      lastName
// formatted                  formatted                       displayName
// active                     active                          status
// telephoneNumber            phoneNumbers.work               phoneNumber
// department                 department                      department
// employeeId                 employeeNumber                  employeeIdentifier
// {configurable}             customAttribute2                CustomAttribute2
// {configurable}             customAttribute3                CustomAttribute3
// {configurable}             customAttribute4                CustomAttribute4
// {configurable}             customAttribute5                CustomAttribute5
// =================================================================================



'use strict'

const http = require('http')
const https = require('https')
const HttpsProxyAgent = require('https-proxy-agent')
const url = require('url')
const querystring = require('querystring')

// mandatory plugin initialization - start
const path = require('path')
let ScimGateway = null
try {
  ScimGateway = require('scimgateway')
} catch (err) {
  ScimGateway = require('./scimgateway')
}
let scimgateway = new ScimGateway()
let pluginName = path.basename(__filename, '.js')
let configDir = path.join(__dirname, '..', 'config')
//let configFile = '../config/plugin-airwatch.json'
let configFile = '/config/plugin-airwatch.json'
let config = require(configFile).endpoint
let validScimAttr = [ // array containing scim attributes supported by our plugin code. Empty array - all attrbutes are supported by endpoint
  'externalId',
  'userName',         // userName is mandatory
  'active',           // active is mandatory
  'name.givenName',
  'name.familyName',
  'name.formatted',
  // "emails",         // accepts all multivalues for this key
  'emails.work',       // accepts multivalues if type value equal work (lowercase)
  'phoneNumbers.work',
  'department',
  'employeeNumber',
  'roles',
  'immutableId',
  'customAttribute2',
  'customAttribute3',
  'customAttribute4',
  'customAttribute5'
]
config = scimgateway.processExtConfig(pluginName, config) // add any external config process.env and process.file
// mandatory plugin initialization - end

let _serviceClient = {}

// =================================================
// exploreUsers
// =================================================
scimgateway.exploreUsers = async (baseEntity, attributes, startIndex, count) => {
  let action = 'exploreUsers'
  scimgateway.logger.debug(`${pluginName} handling "${action}" attributes=${attributes} startIndex=${startIndex} count=${count}`)
  let ret = { // itemsPerPage will be set by scimgateway
    'Resources': [],
    'totalResults': null
  }

  let method = 'GET'
  let path = '/Users?attributes=userName'
  let body = null

  try {
    let response = await doRequest(baseEntity, method, path, body)
    if (response.statusCode < 200 || response.statusCode > 299) {
      let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw (err)
    } else if (!response.body.Resources) {
      let err = new Error(`${action}: Got empty response on REST request`)
      throw (err)
    }
    if (!startIndex && !count) { // client request without paging
      startIndex = 1
      count = response.body.Resources.length
    }
    for (let index = startIndex - 1; index < response.body.Resources.length && (index + 1 - startIndex) < count; ++index) {
      if (response.body.Resources[index].id && response.body.Resources[index].userName) {
        let scimUser = { // userName and id is mandatory, note: we set id=userName
          'userName': response.body.Resources[index].userName,
          'id': response.body.Resources[index].id,
          'externalId': response.body.Resources[index].userName
        }
        ret.Resources.push(scimUser)
      }
    }
      // not needed if client or endpoint do not support paging
    ret.totalResults = response.body.Resources.length
    ret.startIndex = startIndex
    return ret // all explored users
  } catch (err) {
    throw err
  }
}

// =================================================
// exploreGroups
// =================================================
scimgateway.exploreGroups = async (baseEntity, attributes, startIndex, count) => {
  let action = 'exploreGroups'
  scimgateway.logger.debug(`${pluginName} handling "${action}" attributes=${attributes} startIndex=${startIndex} count=${count}`)
  let ret = { // itemsPerPage will be set by scimgateway
    'Resources': [],
    'totalResults': null
  }

  let method = 'GET'
  let path = '/Groups?attributes=displayName'
  let body = null

  try {
    let response = await doRequest(baseEntity, method, path, body)
    if (response.statusCode < 200 || response.statusCode > 299) {
      let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    } else if (!response.body.Resources) {
      let err = new Error(`${action}: Got empty response on REST request`)
      throw err
    }
    if (!startIndex && !count) { // client request without paging
      startIndex = 1
      count = response.body.Resources.length
    }
    for (let index = startIndex - 1; index < response.body.Resources.length && (index + 1 - startIndex) < count; ++index) {
      if (response.body.Resources[index].id && response.body.Resources[index].displayName) {
        let scimGroup = { // displayName and id is mandatory, note: we set id=displayName
          'displayName': response.body.Resources[index].displayName,
          'id': response.body.Resources[index].id,
          'externalId': response.body.Resources[index].displayName
        }
        ret.Resources.push(scimGroup)
      }
    }
    // not needed if client or endpoint do not support paging
    ret.totalResults = response.body.Resources.length
    ret.startIndex = startIndex
    return ret // all explored users
  } catch (err) {
    throw err
  }
}

// =================================================
// getUser
// =================================================
scimgateway.getUser = async (sourceToken, baseEntity, userName, searchMethod, attributes) => {
  let action = 'getUser'
  let arrAttr = []
  let trueGUID
  let awinfo = {}
  // trueGUID = await buildGUID(userName, "decode")    // need to transform base64 -> guid
  if (attributes) arrAttr = attributes.split(',')
  if (attributes && arrAttr.length < 3) { // userName and/or id - check if user exist
    let method = 'GET'
    let path = null
    let body = null

    if (searchMethod === "userName") {    // this is an initial query
      path = `/system/users/search?username=${userName}`
    } else if (searchMethod === "externalId") {   // this is a GET
      //trueGUID = await buildGUID(userName, "decode")    // need to transform base64 -> guid
      //path = `/system/users/search?externalId=${trueGUID}`
      path = `/system/users/search?externalId=${userName}`
    }

    try {
      let response = await doRequest(baseEntity, method, path, body, sourceToken, 1)
      if (response.statusCode < 200 || response.statusCode > 299) {
        let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
        throw err
      } else if (!response.body) {
        //let err = new Error(`${action}: Got empty response on REST request`)
        //throw err
        return null
      }
      let userObj = response.body.Users.find(function (element) { // Verify user exist
        return element.ExternalId === userName
      })
      if (!userObj) return null // no user found

      /*
      if (userObj.ExternalId) {   // need to transform guid -> base64
        trueGUID = await buildGUID(userObj.ExternalId, "encode")
      }
      */

      let retObj = {
        //'id': trueGUID,
        'id': userObj.Uuid,
        'userName': userObj.UserName,
        //'externalId': trueGUID
        'externalId': userObj.externalId
      }
      return retObj // return user found
    } catch (err) {
      throw err
    }
  } else { // all endpoint supported attributes
    let method = 'GET'
    let path = null
    let body = null

    /*
    if (searchMethod === "userName") {    // this is an initial query
      awinfo = await getAirwatchInfo(baseEntity, "username", userName, sourceToken, action)
      path = `/system/users/${awinfo.uuid}`
      //path = `/system/users/search?username=${userName}`
    } else if (searchMethod === "externalId" || !searchMethod) {   // this is a GET
      //trueGUID = await buildGUID(userName, "decode")    // need to transform base64 -> guid
      //path = `/system/users/search?externalId=${trueGUID}`
      awinfo = await getAirwatchInfo(baseEntity, "userid", userName, sourceToken, action)
      path = `/system/users/${awinfo.uuid}`
      //path = `/system/users/search?externalId=${userName}`
    }
    */

    if (!searchMethod || searchMethod === '') searchMethod = 'externalId'

    awinfo = await getAirwatchInfo(baseEntity, searchMethod, userName, sourceToken, action)
    if (!awinfo) return null
    path = `/system/users/${awinfo.uuid}`

    try {
      let response = await doRequest(baseEntity, method, path, body, sourceToken, 2)
      if (response.statusCode < 200 || response.statusCode > 299) {
        let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
        throw err
      } else if (!response.body) {
        //let err = new Error(`${action}: Got empty response on REST request`)
        //throw err
        return null
      } /*
      let userObj = response.body.find(function (element) { // Verify user exist
        if (searchMethod === "userName") {
          return element.userName === userName
        } else if (searchMethod ==="externalId" || !searchMethod) {
          //return element.ExternalId === trueGUID
          return element.externalId === userName
        }
       //return element.UserName === userName
      }) */

      let userObj = response.body
      if (!userObj) return null // no user found

      if (!userObj.name) userObj.name = {}
      if (!userObj.emails) userObj.emails = [{}]
      if (!userObj.phoneNumbers) userObj.phoneNumbers = [{}]
      if (!userObj.entitlements) userObj.entitlements = [{}]

      let objWorkEmail = scimgateway.getArrayObject(userObj, 'emails', 'work')
      let objWorkPhone = scimgateway.getArrayObject(userObj, 'phoneNumbers', 'work')
      let objCompanyEntitlement = scimgateway.getArrayObject(userObj, 'entitlements', 'company')

      let arrEmail = []
      let arrPhone = []
      let arrEntitlement = []
      if (objWorkEmail) arrEmail.push(objWorkEmail)
      else arrEmail = [{"value": userObj.Email, "type": "work"}]
      if (objWorkPhone) arrPhone.push(objWorkPhone)
      else arrPhone = null
      if (objCompanyEntitlement) arrEntitlement.push(objCompanyEntitlement)
      else arrEntitlement = null

      if (userObj.customAttribute1) {
        trueGUID = await buildGUID(userObj.customAttribute1, "encode")
      }

      let retObj = {
        'userName': userObj.userName,
        //'id': trueGUID,
        //'externalId': trueGUID,
        'id': userObj.externalId,
        'externalId': userObj.uuid,
        'active': userObj.status,
        'name': {
          'givenName': userObj.firstName || '',
          'familyName': userObj.lastName || '',
          'formatted': userObj.firstName + ' ' + userObj.lastName || ''
        },
        //'title': userObj.title,
        'emails': [{
          "primary": true,
          "type": "work",
          "value": userObj.emailAddress
        }],
        'phoneNumbers': [{
          "type": "work",
          "value": userObj.phoneNumber
        }],
        //'entitlements': arrEntitlement,
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
          'department': userObj.department,
          'employeeNumber': userObj.employeeIdentifier
        },
        'urn:ietf:params:scim:schemas:extension:scimgateway:2.0:User': {
          'immutableId': trueGUID,
          'customAttribute2': userObj.customAttribute2,
          'customAttribute3': userObj.customAttribute3,
          'customAttribute4': userObj.customAttribute4,
          'customAttribute5': userObj.customAttribute5
        }
      }
      return retObj // return user found
    } catch (err) {
      throw err
    }
  } // else
}

// =================================================
// createUser
// =================================================
scimgateway.createUser = async (sourceToken, baseEntity, userObj) => {
  let action = 'createUser'
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" userObj=${JSON.stringify(userObj)}`)

  let notValid = scimgateway.notValidAttributes(userObj, validScimAttr)
  if (notValid) {
    let err = new Error(`unsupported scim attributes: ${notValid} ` +
      `(supporting only these attributes: ${validScimAttr.toString()})`
    )
    throw err
  }

  if (!userObj.name) userObj.name = {}
  if (!userObj.emails) userObj.emails = { 'work': {} }
  if (!userObj.phoneNumbers) userObj.phoneNumbers = { 'work': {} }
  if (!userObj.entitlements) userObj.entitlements = { 'company': {} }

  let arrEmail = []
  let arrPhone = []
  let arrEntitlement = []
  if (userObj.emails.work.value) arrEmail.push(userObj.emails.work)
  if (userObj.phoneNumbers.work.value) arrPhone.push(userObj.phoneNumbers.work)
  if (userObj.entitlements.company.value) arrEntitlement.push(userObj.entitlements.company)

  let trueGUID

  /*
  if (userObj.externalId) {
    trueGUID = await buildGUID(userObj.externalId, "decode")
  }
  */

  if (userObj.immutableId) {
    trueGUID = await buildGUID(userObj.immutableId, "decode")
  }

  let method = 'POST'
  let path = '/system/Users'
  let body = {
    'externalId': userObj.externalId,
    'userName': userObj.userName,
    'status': userObj.active || true,
    'firstName': userObj.name.givenName,
    'lastName': userObj.name.familyName,
    'displayName': userObj.name.formatted,
    'phoneNumber': userObj.phoneNumbers.work.value,
    'department': userObj.department,
    'employeeIdentifier': userObj.employeeNumber,
    'emailAddress': userObj.emails.work.value,
    'emailUsername': userObj.emails.work.value,
    'aadMappingAttribute': trueGUID,
    'customAttribute1': trueGUID,
    'customAttribute2': userObj.customAttribute2,
    'customAttribute3': userObj.customAttribute3,
    'customAttribute4': userObj.customAttribute4,
    'customAttribute5': userObj.customAttribute5,
    'securityType': "directory"
  }

  try {
    let response = await doRequest(baseEntity, method, path, body, sourceToken, 2)
    if (response.statusCode < 200 || response.statusCode > 299) {
      let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    }
    return response
  } catch (err) {
    throw err
  }
}

// =================================================
// deleteUser
// =================================================
scimgateway.deleteUser = async (sourceToken, baseEntity, id) => {
  let action = 'deleteUser'
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" id=${id}`)
  let awinfo = {}
  try {
    awinfo = await getAirwatchInfo(baseEntity, "externalId", id, sourceToken, action)
    if (!awinfo.uuid) {
      let err = new Error(`Error message: No Uuid returned for user ${id}`)
      throw err
    }
  } catch (err) {
    throw err
  }

  let method = 'DELETE'
  let path = `/system/users/${awinfo.uuid}`
  let body = null

  try {
    let response = await doRequest(baseEntity, method, path, body, sourceToken, 2)
    if (response.statusCode < 200 || response.statusCode > 299) {
      let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    }
    return null
  } catch (err) {
    throw err
  }
}

// =================================================
// modifyUser
// =================================================
scimgateway.modifyUser = async (sourceToken, baseEntity, id, attrObj) => {
  let action = 'modifyUser'
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" id=${id} attrObj=${JSON.stringify(attrObj)}`)

  let notValid = scimgateway.notValidAttributes(attrObj, validScimAttr)
  if (notValid) {
    let err = new Error(`unsupported scim attributes: ${notValid} ` +
      `(supporting only these attributes: ${validScimAttr.toString()})`
    )
    throw err
  }

  let awinfo = {}
  try {
    awinfo = await getAirwatchInfo(baseEntity, "externalId", id, sourceToken, action)
    if (!awinfo.uuid) {
      let err = new Error(`Error message: No Uuid returned for user ${id}`)
      throw err
    }
  } catch (err) {
    throw err
  }

  if (!attrObj.name) attrObj.name = {}
  if (!attrObj.emails) attrObj.emails = {}
  if (!attrObj.phoneNumbers) attrObj.phoneNumbers = {}
  if (!attrObj.entitlements) attrObj.entitlements = {}

  let arrEmail = []
  let arrPhone = []
  let arrEntitlement = []
  if (attrObj.emails.work) arrEmail.push(attrObj.emails.work)
  if (attrObj.phoneNumbers.work) arrPhone.push(attrObj.phoneNumbers.work)
  if (attrObj.entitlements.company) arrEntitlement.push(attrObj.entitlements.company)

  let body = {}

  if (attrObj.name.givenName || attrObj.name.givenName === '') {
    body.firstName = attrObj.name.givenName
  }
  if (attrObj.name.familyName || attrObj.name.familyName === '') {
    body.lastName = attrObj.name.familyName
  }
  if (attrObj.name.formatted || attrObj.name.formatted === '') {
    body.displayName = attrObj.name.formatted
  }
  if (attrObj.department || attrObj.department === '') {
    body.department = attrObj.department
  }
  if (attrObj.employeeNumber || attrObj.employeeNumber === '') {
    body.employeeIdentifier = attrObj.employeeIdentifier
  }
  if (arrEmail.length > 0) {
    body.emailAddress = attrObj.emails.work.value
    body.emailUsername = attrObj.emails.work.value
  }
  if (arrPhone.length > 0) {
    body.phoneNumber = attrObj.phoneNumbers.work.value
  }
  if (attrObj.customAttribute2 || attrObj.customAttribute2 === '') {
    body.customAttribute2 = attrObj.customAttribute2
  }
  if (attrObj.customAttribute3 || attrObj.customAttribute3 === '') {
    body.customAttribute3 = attrObj.customAttribute3
  }
  if (attrObj.customAttribute4 || attrObj.customAttribute4 === '') {
    body.customAttribute4 = attrObj.customAttribute4
  }
  if (attrObj.customAttribute5 || attrObj.customAttribute5 === '') {
    body.customAttribute5 = attrObj.customAttribute5
  }

  let acceptVersion = null
  let method = null
  let path = null

  //this is so annoying
  let awstatus = awinfo.active.toString()
  let uscimstatus = null
  if (attrObj.active) {
    uscimstatus = attrObj.active.toLowerCase()
  }

  if (attrObj.active == null || awstatus == uscimstatus || awinfo.active == attrObj.active) {   // not a user status change
    acceptVersion = 2
    method = 'PUT'
    path = `/system/Users/${awinfo.uuid}`
  } else {    // time to alter the user status
    acceptVersion = 1
    method = 'POST'
    if (attrObj.active == true || uscimstatus == "true") {
      path = `/system/users/${awinfo.id}/activate`
    } else if (attrObj.active == false || uscimstatus == "false") {
      path = `/system/users/${awinfo.id}/deactivate`
    }
  }

  try {
    let response = await doRequest(baseEntity, method, path, body, sourceToken, acceptVersion)
    if (response.statusCode < 200 || response.statusCode > 299) {
      let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    }
    /* let retObj = {
      'userName': awinfo.userName,
      'id': id,
      'externalId': id,
      'active': attrObj.active ? attrObj.active : awstatus,
      'name': {
        'givenName': response.FirstName || '',
        'familyName': response.LastName || '',
        'formatted': response.FirstName + ' ' + response.LastName || ''
      },
      'emails': [{"value": response.EmailAddress, "type": "work"}]
    } */
    return null
  } catch (err) {
    throw err
  }
}

// =================================================
// getGroup
// =================================================
scimgateway.getGroup = async (sourceToken, baseEntity, displayName, attributes) => {
  let action = 'getGroup'
  scimgateway.logger.debug(`${pluginName} handling "${action}" displayName=${displayName} attributes=${attributes}`)

  let method = 'GET'
  let path = `/system/usergroups/custom/search?groupname=${displayName}`
  let body = null

  try {
    let response = await doRequest(baseEntity, method, path, body, sourceToken, 1)
    if (response.statusCode < 200 || response.statusCode > 299) {
      let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    } else if (!response.body) {
      //let err = new Error(`${action}: Got empty response on REST request`)
      //throw err
      return null
    }
    let retObj = {}
    if (response.body.UserGroup.length === 1) {
      let grp = response.body.UserGroup[0]
      retObj.displayName = grp.UserGroupName // displayName is mandatory
      retObj.id = grp.UserGroupName
      retObj.externalId = grp.UserGroupName // mandatory for Azure AD
      if (Array.isArray(grp.members)) {
        retObj.members = []
        grp.members.forEach(function (el) {
          retObj.members.push({ 'value': el.value })
        })
      }
    }
    return retObj
  } catch (err) {
    throw err
  }
}

// =================================================
// getGroupMembers
// =================================================
scimgateway.getGroupMembers = async (baseEntity, id, attributes) => {
  let action = 'getGroupMembers'
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" user id=${id} attributes=${attributes}`)
  let arrRet = []
  return arrRet   // get rid of this if supporting function - see duplicate call below
  /*
  let method = 'GET'
  let path = `/Groups?filter=members.value eq "${id}"&attributes=${attributes}` // GET = /Groups?filter=members.value eq "bjensen"&attributes=members.value,displayName
  let body = null

  try {
    let response = await doRequest(baseEntity, method, path, body)
    if (!response.body.Resources) {
      let err = new Error(`${action}: Got empty response on REST request`)
      throw err
    }
    response.body.Resources.forEach(function (element) {
      if (Array.isArray(element.members)) {
        element.members.forEach(function (el) {
          if (el.value === id) { // user is member of group
            let userGroup = {
              'displayName': element.displayName,   // displayName is mandatory
              'members': [{ 'value': el.value }]    // only includes current user
            }
            arrRet.push(userGroup)
          }
        })
      }
    })
    return arrRet
  } catch (err) {
    throw err
  }
  */
}

// =================================================
// getGroupUsers
// =================================================
scimgateway.getGroupUsers = async (baseEntity, groupName, attributes) => {
  let action = 'getGroupUsers'
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" groupName=${groupName} attributes=${attributes}`)
  let arrRet = []
  return arrRet
}

// =================================================
// createGroup
// =================================================
scimgateway.createGroup = async (sourceToken, baseEntity, groupObj) => {
  let action = 'createGroup'
  scimgateway.logger.debug(`${pluginName} handling "${action}" groupObj=${JSON.stringify(groupObj)}`)

  let method = 'POST'
  let path = '/system/usergroups/createcustomusergroup'
  let body = { 'GroupName': groupObj.displayName }

  try {
    let response = await doRequest(baseEntity, method, path, body, sourceToken, 1)
    if (response.statusCode < 200 || response.statusCode > 299) {
      let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    }
    return response
  } catch (err) {
    throw err
  }
}

// =================================================
// deleteGroup
// =================================================
scimgateway.deleteGroup = async (sourceToken, baseEntity, id) => {
  let action = 'deleteGroup'
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" id=${id}`)
  
  let awinfo = {}
  try {
    awinfo = await getAirwatchInfo(baseEntity, "group", id, sourceToken, action)
    if (!awinfo.userGroupId) {
      let err = new Error(`Error message: No group id returned for group ${id}`)
      throw err
    }
  } catch (err) {
    throw err
  }
  let method = 'DELETE'
  let path = `/system/usergroups/${awinfo.userGroupId}/delete`
  let body = null

  try {
    let response = await doRequest(baseEntity, method, path, body, sourceToken, 1)
    if (response.statusCode < 200 || response.statusCode > 299) {
      let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    }
    return null
  } catch (err) {
    throw err
  }
}

// =================================================
// modifyGroupMembers
// =================================================
scimgateway.modifyGroupMembers = async (sourceToken, baseEntity, id, members) => {
  let action = 'modifyGroupMembers'
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" id=${id} members=${JSON.stringify(members)}`)

  let awinfo = {}

  try {
    awinfo = await getAirwatchInfo(baseEntity, "group", id, sourceToken, action)
    if (!awinfo.userGroupId) {
      let err = new Error(`Error message: No group id returned for group ${id}`)
      throw err
    }
  } catch (err) {
    throw err
  }
  let awGroupId = awinfo.userGroupId

  if (Array.isArray(members)) {
    
    await Promise.all(members.map(async members => {

      awinfo = {}
      try {
        awinfo = await getAirwatchInfo(baseEntity, "externalId", members.value, sourceToken, action)
        if (!awinfo.uuid) {
          let err = new Error(`Error message: No Uuid returned for user ${id}`)
          throw err
        }
      } catch (err) {
        throw err
      }
      
      let method = null
      let path = null
      let body = {}
      
      if (members.operation && members.operation === 'delete') { // delete member from group
        method = 'POST'
        path = `/system/usergroups/${awGroupId}/user/${awinfo.id}/removeuserfromgroup`
      } else { // add member to group/
        method = 'POST'
        path = `/system/usergroups/${awGroupId}/user/${awinfo.id}/addusertogroup`
      }
      try {
        let response = await doRequest(baseEntity, method, path, body, sourceToken, 1)
        if (response.statusCode < 200 || response.statusCode > 299) {
          let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
          throw err
        }
        return null
      } catch (err) {
        throw err
      }
    }));
  } // if Array
}
//
// buildGUID - pretty up some hex encoding
//
let buildGUID = async (userAnchor, buildAction) => {
  let convertedAnchor
  if (buildAction === "encode") {
    convertedAnchor = userAnchor.replace(/-/g, '')
    let hexTemplate = '{3}{2}{1}{0}{5}{4}{7}{6}{8}{9}{10}{11}{12}{13}{14}{15}'
    let z = 0
    for ( var i = 0; i < convertedAnchor.length; ) {
      // get the current character from that byte
      let dataStr = convertedAnchor[ i ].toString( 16 ) + convertedAnchor[ i + 1 ].toString( 16 );
      //dataStr = convertedAnchor[ i ] >= 16 ? dataStr : '0' + dataStr;

      // insert that character into the template
      hexTemplate = hexTemplate.replace( new RegExp( '\\{' + z + '\\}', 'g' ), dataStr );
      i = i + 2
      z = z + 1
    }
    convertedAnchor = Buffer.from(hexTemplate, 'hex').toString('base64')
  } else if (buildAction === "decode") {
    convertedAnchor = Buffer.from(userAnchor, 'base64').toString('hex')
    let uuidTemplate = '{3}{2}{1}{0}-{5}{4}-{7}{6}-{8}{9}-{10}{11}{12}{13}{14}{15}'
    let z = 0
    for ( var i = 0; i < convertedAnchor.length; ) {
      // get the current character from that byte
      let dataStr = convertedAnchor[ i ].toString( 16 ) + convertedAnchor[ i + 1 ].toString( 16 );
      //dataStr = convertedAnchor[ i ] >= 16 ? dataStr : '0' + dataStr;

      // insert that character into the template
      uuidTemplate = uuidTemplate.replace( new RegExp( '\\{' + z + '\\}', 'g' ), dataStr );
      i = i + 2
      z = z + 1
    }
    convertedAnchor = uuidTemplate
  }
  return convertedAnchor
}

//
// getAirwatchInfo - convert AirWatch source anchor to uuid
//
let getAirwatchInfo = async (baseEntity, resourceType, sourceAnchor, passthruToken, action) => {
  let method = 'GET'
  let path = null
  if (resourceType === "externalId") {
    //sourceAnchor = await buildGUID(sourceAnchor, "decode")    // need to transform base64 -> guid
    path = `/system/users/search?externalId=${sourceAnchor}`
  } else if (resourceType === "group") {
    path = `/system/usergroups/custom/search?groupname=${sourceAnchor}`
  } else if (resourceType === "userName") {
    path = `/system/users/search?userName=${sourceAnchor}`
  }
  let body = null
  try {
    let response = await doRequest(baseEntity, method, path, body, passthruToken, 1)
    if (response.statusCode < 200 || response.statusCode > 299) {
      if (action === "getUser") {
        return null
      } else {
        let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
        throw err
      }
      //let err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      //throw err
    } else if (!response.body) {
      if (action === "getUser") {
        return null
      } else {
        let err = new Error(`${action}: Got empty response on REST request`)
        throw err
      }
      //let err = new Error(`${action}: Got empty response on REST request`)
      //throw err
    }
    if (resourceType === "externalId" || resourceType === "userName") {
      let userObj = response.body.Users.find(function (element) { // Verify user exist
        return (element.ExternalId === sourceAnchor || element.UserName === sourceAnchor)
      })
      if (!userObj) return null // no user found
  
      let retObj = {
        'userName': userObj.UserName,
        'id': userObj.Id.Value,
        'uuid': userObj.Uuid,
        'externalId': userObj.ExternalId,
        'immutableId': userObj.CustomAttribute1,
        'active': userObj.Status,
        'email': userObj.Email,
        'first': userObj.FirstName,
        'last': userObj.LastName
      }

      return retObj // return user uuid
    } else if (resourceType === "group") {
      let groupObj = response.body.UserGroup.find(function (element) { // Verify group exist
        return element.UserGroupName === sourceAnchor
      })
      if (!groupObj) return null // no group found
  
      let retObj = {
        'userGroupName': groupObj.UserGroupName,
        'userGroupId': groupObj.UserGroupId,
        'externalId': groupObj.UserGroupName
      }

      return retObj // return user uuid
    }
  } catch (err) {
    throw err
  }
}

//
// getServiceClient - returns options needed for connection parameters
//
//   path = e.g. "/xxx/yyy", then using host/port/protocol based on config baseUrls[0]
//          auth automatically added and failover according to baseUrls array
//
//   path = url e.g. "http(s)://<host>:<port>/xxx/yyy", then using the url host/port/protocol
//          opt (options) may be needed e.g {auth: {username: "username", password: "password"} }
//
let getServiceClient = async (baseEntity, method, path, opt, passthruToken, apiVersion) => {
  let action = 'getServiceClient'

  let host = null
  if (!path) path = ''
  if (path) host = url.parse(path).hostname

  if (!host) {
    //
    // path (no url) - default approach and client will be cached based on config
    //
    if (_serviceClient[baseEntity]) { // serviceClient already exist
      scimgateway.logger.debug(`${pluginName}[${baseEntity}] ${action}: Using existing client`)
    } else {
      scimgateway.logger.debug(`${pluginName}[${baseEntity}] ${action}: Client have to be created`)
      let client = null
      if (config.entity && config.entity[baseEntity]) client = config.entity[baseEntity]
      if (!client) {
        let err = new Error(`Base URL have baseEntity=${baseEntity}, and configuration file ${pluginName}.json is missing required baseEntity configuration for ${baseEntity}`)
        throw err
      }

      let param = {
        'baseUrl': config.entity[baseEntity].baseUrl,
        'options': {
          'json': true, // json-object response instead of string
          'headers': {
            'Content-Type': 'application/json',
            'aw-tenant-code': config.entity[baseEntity].tenantCode
          }
          // 'method' and 'path' added at the end
        }
      }

      if(passthruToken) {
        param.options.headers.Authorization = passthruToken
      }

      if (apiVersion == 1) {
        param.options.headers.Accept = 'application/json;version=1'
      } else if (apiVersion == 2) {
        param.options.headers.Accept = 'application/json;version=2'
      } else {
        param.options.headers.Accept = 'application/json'
      }

      // proxy
      if (config.entity[baseEntity].proxy && config.entity[baseEntity].proxy.host) {
        let agent = new HttpsProxyAgent(config.entity[baseEntity].proxy.host)
        param.options.agent = agent // proxy
        if (config.entity[baseEntity].proxy.username && config.entity[baseEntity].proxy.password) {
          param.options.headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${config.entity[baseEntity].proxy.username}:${scimgateway.getPassword(`endpoint.entity.${baseEntity}.proxy.password`, configFile)}`).toString('base64') // using proxy with auth
        }
      }

      if (!_serviceClient[baseEntity]) _serviceClient[baseEntity] = {}
      _serviceClient[baseEntity] = param // serviceClient created
    }

    let options = scimgateway.copyObj(_serviceClient[baseEntity].options) // client ready

    // failover support
    path = _serviceClient[baseEntity].baseUrl + path
    options.host = url.parse(path).hostname
    options.port = url.parse(path).port
    options.protocol = url.parse(path).protocol

    // adding none static
    options.method = method
    options.path = url.parse(path).path
    if (opt) options = scimgateway.extendObj(options, opt) // merge with argument options

    _serviceClient = {} //need to do some house cleaning here
    return options // final client
  } else {
    //
    // url path - none config based and used as is (no cache)
    //
    scimgateway.logger.debug(`${pluginName}[${baseEntity}] ${action}: Using none config based client`)
    let options = {
      'json': true,
      'headers': {
        'Content-Type': 'application/json'
      },
      'host': url.parse(path).hostname,
      'port': url.parse(path).port,
      'protocol': url.parse(path).protocol,
      'method': method,
      'path': url.parse(path).path
    }

    // proxy
    if (config.entity[baseEntity].proxy && config.entity[baseEntity].proxy.host) {
      let agent = new HttpsProxyAgent(config.entity[baseEntity].proxy.host)
      options.agent = agent // proxy
      if (config.entity[baseEntity].proxy.username && config.entity[baseEntity].proxy.password) {
        options.headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${config.entity[baseEntity].proxy.username}:${scimgateway.getPassword(`endpoint.entity.${baseEntity}.proxy.password`, configFile)}`).toString('base64') // using proxy with auth
      }
    }

    // merge any argument options - support basic auth using {auth: {username: "username", password: "password"} }
    if (opt) {
      let o = scimgateway.copyObj(opt)
      if (o.auth) {
        options.headers.Authorization = 'Basic ' + Buffer.from(`${o.auth.username}:${o.auth.password}`).toString('base64')
        delete o.auth
      }
      options = scimgateway.extendObj(options, o)
    }
    _serviceClient = {} //need to do some house cleaning here
    return options // final client
  }
}

//
// doRequest - execute REST service
//
let doRequest = async (baseEntity, method, path, body, passthruToken, apiVersion, opt, retryCount) => {
  try {
    let options = await getServiceClient(baseEntity, method, path, opt, passthruToken, apiVersion)
    let result = await new Promise((resolve, reject) => {
      let dataString = ''
      if (body) {
        if (options.headers['Content-Type'].toLowerCase() === 'application/x-www-form-urlencoded') {
          if (typeof data === 'string') dataString = body
          else dataString = querystring.stringify(body) // JSON to query string syntax + URL encoded
        } else dataString = JSON.stringify(body)
        options.headers['Content-Length'] = Buffer.byteLength(dataString, 'utf8')
      }
      let reqType = (options.protocol.toLowerCase() === 'https:') ? https.request : http.request

      let req = reqType(options, (res) => {
        const { statusCode, statusMessage } = res // solving parallel problem (const + don't use res.statusCode)

        let responseString = ''
        res.setEncoding('utf-8')

        res.on('data', (chunk) => {
          responseString += chunk
        })

        res.on('end', () => {
          let response = {
            'statusCode': statusCode,
            'statusMessage': statusMessage,
            'body': null
          }
          try {
            if (responseString) response.body = JSON.parse(responseString)
          } catch (err) { response.body = responseString }
          if (statusCode < 200 || statusCode > 299) reject(new Error(JSON.stringify(response)))
          resolve(response)
        })
      }) // req

      req.on('socket', (socket) => {
        socket.setTimeout(60000) // connect and wait timeout => socket hang up
        socket.on('timeout', function () { req.abort() })
      })

      req.on('error', (error) => { // also catching req.abort
        req.end()
        reject(error)
      })

      if (dataString) req.write(dataString)
      req.end()
    }) // Promise

    scimgateway.logger.debug(`${pluginName}[${baseEntity}] doRequest ${method} ${options.protocol}//${options.host}${(options.port ? `:${options.port}` : '')}${path} Body = ${JSON.stringify(body)} Response = ${JSON.stringify(result)}`)
    return result
  } catch (err) { // includes failover/retry logic based on config baseUrls array
    if (!retryCount) retryCount = 0
    if (!url.parse(path).hostname && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
      if (retryCount < config.entity[baseEntity].baseUrls.length) {
        retryCount++
        _serviceClient[baseEntity].baseUrl = config.entity[baseEntity].baseUrls[retryCount - 1] // baseUrl changed
        scimgateway.logger.debug(`${pluginName}[${baseEntity}] ${(config.entity[baseEntity].baseUrls.length > 1) ? 'failover ' : ''}retry[${retryCount}] using baseUrl = ${_serviceClient[baseEntity].baseUrl}`)
        let ret = await doRequest(baseEntity, method, path, body, opt, retryCount) // retry
        return ret // problem fixed
      } else {
        let newerr = new Error(err.message)
        newerr.message = newerr.message.replace('ECONNREFUSED', 'UnableConnectingService') // avoid returning ECONNREFUSED error
        newerr.message = newerr.message.replace('ENOTFOUND', 'UnableConnectingHost') // avoid returning ENOTFOUND error
        throw newerr
      }
    } else throw err // CA IM retries getUser failure once (retry 6 times on ECONNREFUSED)
  }
} // doRequest

//
// Cleanup on exit
//
process.on('SIGTERM', () => { // kill
})
process.on('SIGINT', () => {   // Ctrl+C
})

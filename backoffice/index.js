require('../environment')
const moment = require('moment')
const { IDMClient } = require('./idm')
const { EchoClient } = require('./echo')
const hubspot = require('./hubspot')
const { PHASES, isValidPhase, isUserALearner, isUserActive, isUserInactive } = require('./util')

module.exports = class BackOffice {

  constructor(lgJWT){
    this.idm = new IDMClient(lgJWT)
    this.echo = new EchoClient(lgJWT)
    this.hubspot = hubspot
  }

  getAllUsers(options={}){
    options = Object.assign(
      // default options
      {
        active: true,
        learners: false,
        phase: undefined,
        includePhases: false,
        includeHubspotData: false,
      },
      options
    )

    if (isValidPhase(options.phase)){
      options.includePhases = true
    }else{
      delete options.phase
    }

    return this.idm.getAllUsers()
      .then(users => {
        if (!Array.isArray(users)){
          throw new Error(`${typeof users} is not array`)
        }

        // filters
        if (options.learners) users = users.filter(isUserALearner)
        if (options.active === true) users = users.filter(isUserActive)
        if (options.active === false) users = users.filter(isUserInactive)

        // load extra data
        const promises = []
        if (options.includePhases) promises.push(this.getPhasesForUsers(users))
        if (options.includeHubspotData) promises.push(this.getHubspotDataForUsers(users))

        return Promise.all(promises).then(_ => users)
      })
      .then(users =>
        options.phase
          ? users.filter(user => user.phase === options.phase)
          : users
      )
  }

  getAllLearners(options={}){
    options.learners = true
    return this.getAllUsers(options)
  }

  getUserByHandle(handle, options={}){
    options = Object.assign(
      // default options
      {
        includeHubspotData: false,
      },
      options
    )
    return this.idm
      .getLearnerByHandle(handle)
      .then(user => {
        if (!user) return user
        if (options.includeHubspotData) return getHubspotDataForUser(user)
        return user
      })
  }


  getPhasesForUsers(users){
    return this.echo.getPhasesForUsers(users)
  }

  getHubspotDataForUsers(users){
    const emails = users.map(user => user.email)
    return this.hubspot.getContactsByEmail(emails)
      .then(
        contacts => {
          users.forEach(user => {
            const contact = contacts.find(contact =>
              contact.email === user.email
            )
            if (contact) mergeHubspotContactIntoUser(user, contact)
          })
          return users
        },
        error => {
          users.forEach(user => {
            user.errors = user.errors || []
            user.errors.push(`Erorr loading hubspot contact: ${error.message}`)
          })
          return users
        }
      )
  }
}

const getHubspotDataForUser = user =>
  hubspot.getContactByEmail(user.email)
    .then(hubspotContact =>
      mergeHubspotContactIntoUser(user, hubspotContact)
    )
    .catch(error => {
      user.errors = user.errors || []
      user.errors.push(`Erorr loading hubspot contact: ${error.message}`)
      return user
      // if (error.message.includes('contact does not exist')) return user
      // throw error
    })

const mergeHubspotContactIntoUser = (user, contact) => {
  user.errors = user.errors || []
  user.vid = contact.vid || null
  user.hubspotURL = contact.url || null
  user.nickname = contact.nickname || null

  user._echoPhase = user.phase || null
  user._hubspotPhase = contact.phase || null
  user._hubspotPhaseWeek = contact.phase_week || null

  user.enrolleeStartDate = contact.enrollee_start_date || null

  user.phase1StartDate = contact.date_phase_1 || null
  user.phase2StartDate = contact.date_phase_2 || null
  user.phase3StartDate = contact.date_phase_3 || null
  user.phase4StartDate = contact.date_phase_4 || null
  user.phase5StartDate = contact.date_phase_5 || null


  user.phase = (
    isValidPhase(user._hubspotPhase) ? user._hubspotPhase :
    isValidPhase(user._echoPhase) ? user._echoPhase :
    null
  )

  user.phaseStartDate = user[`phase${user.phase}StartDate`] || null

  user.phaseWeek = (
    contact.phase_week ||
    (user.phaseStartDate && moment().diff(user.phaseStartDate, 'week') ) ||
    null
  )

  PHASES.forEach(phase => {
    user[`phase${phase}StartDate`] = contact[`date_phase_${phase}`]
  })

  user.learningFacilitator = contact.learning_facilitator

  user.personalDevelopmentDaysRemaining = contact.pd_days_remaining || 0
  user.personalDevelopmentDaysUsed = contact.pd_days_used || 0
  user.personalDaysRemaining = contact.personal_days_remaining || 0
  user.personalDaysUsed = contact.personal_days || 0

  user.__hubspotContact = contact

  return user
}

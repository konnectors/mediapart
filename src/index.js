process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://199232aecda94d96ad4afb9619d38d22@errors.cozycloud.cc/35'

const {
  BaseKonnector,
  requestFactory,
  signin,
  saveBills,
  log,
  cozyClient
} = require('cozy-konnector-libs')

const models = cozyClient.new.models
const { Qualification } = models.document

const USER_AGENT =
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:62.0) Gecko/20100101 Firefox/62.0 Cozycloud'
const request = requestFactory({
  // the debug mode shows all the details about http request and responses. Very usefull for
  // debugging but very verbose. That is why it is commented out by default
  // debug: true,
  // activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // this allows request-promise to keep cookies between requests
  jar: true,
  headers: {
    'User-Agent': USER_AGENT
  }
})

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  log('info', 'Getting the session id')
  const $compte = await request('https://moncompte.mediapart.fr/')
  log('info', 'Fetching the list of documents')
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($compte)
  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields.folderPath, {
    keys: ['vendor', 'billId'], // deduplication keys
    identifiers: ['mediapart'], // bank operations
    fileIdAttributes: ['billId'],
    sourceAccount: this.accountId,
    sourceAccountIdentifier: fields.login,
    contentType: 'application/pdf'
  })
}

function authenticate(name, password) {
  return signin({
    url: 'https://www.mediapart.fr/login',
    formSelector: '#logFormEl',
    formData: { name, password },
    // the validate function will check if
    validate: (statusCode, $) => {
      // The login in toscrape.com always works excepted when no password is set
      if ($(`a[href='/logout']`).length === 1) {
        return true
      } else {
        // cozy-konnector-libs has its own logging function which format these logs with colors in
        // standalone and dev mode and as JSON in production mode
        log('error', 'No logout button found after login')
        return false
      }
    }
  })
}

function parseDocuments($) {
  const orders = []
  $('.billing__list__item').each((i, el) => {
    const billData = $(el).html().replace(/\s\s+/g, ' ')
    const [foundHref, billId] = billData.match(
      /<a href="\/facture\/(\d*)\/telecharger"/
    )
    const href = foundHref.split('"')[1]
    const foundDates = billData.match(
      /Du (\d){2}\/(\d){2}\/(\d){4} au (\d){2}\/(\d){2}\/(\d){4}/
    )[0]
    const [, foundStartDate, , foundEndDate] = foundDates.split(' ')
    const { startDate, endDate } = formatDates(foundStartDate, foundEndDate)
    const fileurl = `https://moncompte.mediapart.fr${href}`
    const title = `Mediapart ${billId} ${startDate} - ${endDate}`
    const filename = `mediapart_${billId}_${startDate}_${endDate}.pdf`
    const [amount, currency] = billData
      .match(/ ([0-9.]*) €/)[0]
      .trim()
      .split(' ')
    orders.push({
      vendor: 'Mediapart',
      startDate,
      endDate,
      date: new Date(endDate),
      fileurl,
      billId,
      title,
      filename,
      amount: parseFloat(amount),
      currency,
      fileAttributes: {
        metadata: {
          contentAuthor: 'mediapart.fr',
          issueDate: new Date(),
          datetime: new Date(startDate),
          datetimeLabel: `issueDate`,
          isSubscription: true,
          carbonCopy: true,
          qualification: Qualification.getByLabel('other_invoice')
        }
      },
      requestOptions: {
        headers: {
          'User-Agent': USER_AGENT
        }
      }
    })
  })
  return orders
}

function formatDates(startDate, endDate) {
  const [startDay, startMonth, startYear] = startDate.split('/')
  const [endDay, endMonth, endYear] = endDate.split('/')
  const formatedDates = {
    startDate: `${startYear}-${startMonth}-${startDay}`,
    endDate: `${endYear}-${endMonth}-${endDay}`
  }
  return formatedDates
}

import { createImage } from '../api/createImage'
import { trackEvent } from '../api/telemetry'
import { userInfoStore } from '../store/userStore'
import { initBlob } from './blobUtils'
import { SourceProcessing } from './promptUtils'
import { stylePresets } from './stylePresets'
import { isValidHttpUrl } from './validationUtils'

interface CreateImageJob {
  base64String?: string
  jobId?: string
  img2img?: boolean
  prompt: string
  height: number
  width: number
  cfg_scale: number
  steps: number
  sampler: string
  karras: boolean
  seed?: string
  numImages?: number
  parentJobId?: string
  models: Array<string>
  negative?: string
  source_image?: string
  source_mask?: string
  stylePreset: string
  denoising_strength?: number
  post_processing: Array<string>

  has_source_image?: boolean
  has_source_mask?: boolean
  canvasStore?: any
}

interface OrientationLookup {
  [key: string]: ImageOrientation
}

interface ImageOrientation {
  orientation: string
  height: number
  width: number
}

export const uploadImageConfig = {
  quality: 0.9,
  maxWidth: 1024,
  maxHeight: 1024
}

export const randomSampler = (steps: number, isImg2Img: boolean) => {
  const loggedIn = userInfoStore.state.loggedIn

  const samplerArray = [
    'k_dpm_2_a',
    'k_dpm_2',
    'k_euler_a',
    'k_euler',
    'k_heun',
    'k_lms'
  ]

  // Temporarily hide options due to issues with Stable Horde backend.
  if (!isImg2Img) {
    //   samplerArray.push('DDIM')
    //   samplerArray.push('PLMS')
    samplerArray.push('k_dpm_fast')
    samplerArray.push('k_dpm_adaptive')
    samplerArray.push('k_dpmpp_2m')
    samplerArray.push('k_dpmpp_2s_a')
  }

  if (loggedIn || steps <= 25) {
    return samplerArray[Math.floor(Math.random() * samplerArray.length)]
  } else if (!isImg2Img) {
    const limitedArray = [
      'k_euler_a',
      'k_euler',
      'k_dpm_fast',
      'k_dpm_adaptive',
      'k_dpmpp_2m'
    ]
    return limitedArray[Math.floor(Math.random() * limitedArray.length)]
  } else {
    const limitedArray = ['k_euler_a', 'k_euler']
    return limitedArray[Math.floor(Math.random() * limitedArray.length)]
  }
}

export const orientationDetails = (
  orientation: string,
  height: number = 512,
  width: number = 512
): ImageOrientation => {
  const orientationIds = [
    'landscape-16x9',
    'landscape',
    'phone-bg',
    'portrait',
    'square',
    'ultrawide'
  ]
  const lookup: OrientationLookup = {
    'landscape-16x9': {
      orientation: 'landscape-16x9',
      height: 576,
      width: 1024
    },
    landscape: {
      orientation: 'landscape',
      height: 512,
      width: 768
    },
    portrait: {
      orientation: 'portrait',
      height: 768,
      width: 512
    },
    square: {
      orientation: 'square',
      height: 512,
      width: 512
    },
    'phone-bg': {
      orientation: 'phone-bg',
      height: 1024,
      width: 448
    },
    ultrawide: {
      orientation: 'ultrawide',
      height: 448,
      width: 1024
    }
  }

  if (orientation === 'custom') {
    return {
      orientation: 'custom',
      height: nearestWholeMultiple(height),
      width: nearestWholeMultiple(width)
    }
  }

  if (orientation === 'random') {
    const value =
      orientationIds[Math.floor(Math.random() * orientationIds.length)]

    return {
      ...lookup[value]
    }
  } else if (lookup[orientation]) {
    return {
      ...lookup[orientation]
    }
  }

  return {
    orientation: 'square',
    height: 512,
    width: 512
  }
}

export const createNewImage = async (imageParams: CreateImageJob) => {
  const clonedParams = Object.assign({}, imageParams)
  /**
   * Max prompt length for hlky is roughly 75 tokens.
   * According to: https://beta.openai.com/tokenizer
   * "One token is generally 4 chars of text". I believe
   * Stable Horde silently trims lengthy prompts. I do it
   * here, too, just so someone can't send Shakespeare
   * novels inside a payload.
   */
  clonedParams.prompt = imageParams.prompt.trim()
  if (clonedParams?.prompt?.length > 1024) {
    console.log(
      `Warning: prompt length of ${clonedParams.prompt.length} is greater than 1024 chars. Prompt will be shortned.`
    )
    clonedParams.prompt = clonedParams.prompt.substring(0, 1024)
  }

  // Image Validation
  clonedParams.negative = clonedParams?.negative?.trim()
  if (clonedParams?.negative) {
    clonedParams.prompt += ' ### ' + clonedParams.negative
  }

  if (
    isNaN(clonedParams.steps) ||
    clonedParams.steps > 200 ||
    clonedParams.steps < 1
  ) {
    clonedParams.steps = 200
  }

  if (
    isNaN(clonedParams.cfg_scale) ||
    clonedParams.cfg_scale > 32 ||
    clonedParams.cfg_scale < 1
  ) {
    clonedParams.cfg_scale = 32.0
  }

  try {
    const data = await createImage(clonedParams)
    const { jobId, success, message, status } = data

    if (success && jobId) {
      return {
        success: true,
        jobId
      }
    } else if (!success && status !== 'WAITING_FOR_PENDING_JOB') {
      if (clonedParams.source_image) {
        clonedParams.has_source_image = true
      }

      if (clonedParams.source_mask) {
        clonedParams.has_source_mask = true
      }

      delete clonedParams.base64String
      delete clonedParams.source_image
      delete clonedParams.source_mask
      delete clonedParams.canvasStore

      trackEvent({
        event: 'ERROR',
        action: 'UNABLE_TO_CREATE_IMAGE',
        context: 'imageUtils',
        data: {
          imageParams: clonedParams
        }
      })
      return {
        success: false,
        message,
        status
      }
    }
  } catch (err) {
    if (clonedParams.source_image) {
      clonedParams.has_source_image = true
    }

    if (clonedParams.source_mask) {
      clonedParams.has_source_mask = true
    }

    delete clonedParams.base64String
    delete clonedParams.source_image
    delete clonedParams.source_mask
    delete clonedParams.canvasStore

    trackEvent({
      event: 'ERROR',
      action: 'UNABLE_TO_CREATE_IMAGE',
      context: 'imageUtils',
      data: {
        imageParams: clonedParams
      }
    })
    return {
      success: false,
      message: 'Unable to create image.'
    }
  }
}

export const getBase64 = (file: Blob) => {
  return new Promise((resolve) => {
    let reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      return resolve(reader.result)
    }
  })
}

export const base64toBlob = async (base64Data: string, contentType: string) => {
  try {
    const base64Response = await fetch(
      `data:${contentType};base64,${base64Data}`
    )
    const blob = await base64Response.blob()

    return blob
  } catch (err) {
    return ''
  }
}

export const imageDimensions = (fullDataString: string) => {
  return new Promise((resolve) => {
    var i = new Image()

    i.onload = function () {
      resolve({
        height: i.height,
        width: i.width
      })
    }

    // @ts-ignore
    i.src = fullDataString
  })
}

export const imgUrlToDataUrl = (url: string) => {
  return new Promise((resolve) => {
    try {
      var xhr = new XMLHttpRequest()
      xhr.onload = function () {
        var reader = new FileReader()
        reader.onloadend = function () {
          resolve(xhr.response)
        }
        reader.readAsDataURL(xhr.response)
      }
      xhr.onerror = function () {
        resolve(false)
      }
      xhr.open('GET', url)
      xhr.responseType = 'blob'
      xhr.send()
    } catch (err) {
      resolve(false)
    }
  })
}

export const getImageFromUrl = async (imgUrl: string) => {
  const validUrl = isValidHttpUrl(imgUrl)

  if (!validUrl) {
    return {
      success: false,
      status: 'GET_IMG_FROM_URL_ERROR',
      message: 'Unable to process image from URL, please try something else.'
    }
  }

  const resp = await fetch(`/artbot/api/img-from-url`, {
    method: 'POST',
    body: JSON.stringify({
      imageUrl: imgUrl
    }),
    headers: {
      'Content-Type': 'application/json'
    }
  })
  const data = await resp.json()

  // @ts-ignore
  const { success, imageType, imgBase64String, height, width } = data

  if (!data || !success) {
    trackEvent({
      event: 'ERROR_UPLOAD_IMG_BY_URL',
      context: 'imageUtils',
      data: {
        imgUrl
      }
    })

    return {
      success: false,
      status: 'GET_IMG_FROM_URL_ERROR',
      message: 'Unable to process image from URL, please try something else.'
    }
  }

  trackEvent({
    event: 'UPLOAD_IMG_BY_URL',
    context: 'imageUtils',
    data: {
      imgUrl
    }
  })

  return {
    success: true,
    imgUrl,
    imageType,
    imgBase64String,
    height,
    width
  }
}

export const nearestWholeMultiple = (input: number, X = 64) => {
  let output = Math.round(input / X)
  if (output === 0 && input > 0) {
    output += 1
  }

  output *= X

  return output
}

interface IPresetParams {
  prompt: string
  stylePreset: string
}

export const modifyPromptForStylePreset = ({
  prompt = '',
  stylePreset = 'none'
}: IPresetParams) => {
  // @ts-ignore
  const presetText = { ...stylePresets[stylePreset] }

  // Split any negative prompt from presetText (so we can combine with user's existing negative prompt)
  let [newPrompt = '', presetNeg = ''] = presetText?.prompt
    ? presetText.prompt.split('###')
    : []

  // Split negative prompt so it can be combined with preset negative prompt.
  const [initPrompt = '', negative = ''] = prompt.split('###')

  // Replace key in preset style text
  const regex = /{p}/i
  newPrompt = newPrompt.replace(regex, initPrompt.trim())

  // Handle negative prompt
  if (presetNeg || negative) {
    newPrompt =
      newPrompt +
      ' ### ' +
      [presetNeg ? presetNeg + ', ' : '', negative].join('')
  }

  return newPrompt
}

export const kudosCost = (
  width: number,
  height: number,
  steps: number,
  n: number,
  hasUpscaler: boolean,
  numPostProcessors: number,
  sampler: string
): number => {
  const result =
    Math.pow(width * height - 64 * 64, 1.75) /
    Math.pow(1024 * 1024 - 64 * 64, 1.75)
  let kudos = 0.1232 * steps + result * (0.1232 * steps * 8.75)
  if (hasUpscaler) {
    kudos *= 1.3
  }
  if (numPostProcessors > 0) {
    kudos = kudos * (1 + 0.2 * numPostProcessors)
  }
  kudos *= /k_heun|dpm_2|k_dpmpp_2s_a/.test(sampler) ? 2 : 1
  kudos *= n
  return Math.round(kudos)
}

export const downloadImages = async (
  imageArray: Array<any> = [],
  callback = () => {}
) => {
  initBlob()

  const { downloadZip } = await import('client-zip')
  const fileDetails: any = []
  const fileArray: any = []

  for (const imageId in imageArray) {
    const image: any = imageArray[imageId]

    let filename = `image_${imageId}.png`

    if (image.prompt) {
      filename =
        image.prompt
          .replace(/[^a-z0-9]/gi, '_')
          .toLowerCase()
          .slice(0, 125) + `_${imageId}.png`
    }

    const imageData = {
      name: filename,
      date: new Date(image.timestamp),
      prompt: image.prompt,
      negative_prompt: image.negative,
      sampler: image.sampler,
      model: image.models ? image.models[0] : image.model || 'stable_diffusion',
      height: image.height,
      width: image.width,
      steps: Number(image.steps),
      cfg_scale: Number(image.cfg_scale),
      seed: image.seed
    }

    if (image.img2img || image.source_processing === SourceProcessing.Img2Img) {
      // @ts-ignore
      imageData.denoising_strength = image.denoising_strength
    }

    fileDetails.push(imageData)
    try {
      const input = await base64toBlob(image.base64String, 'image/webp')
      if (input) {
        // @ts-ignore
        const newBlob = await input?.toPNG()

        fileArray.push({
          name: filename,
          lastModified: new Date(image.timestamp),
          input: newBlob
        })
      }
    } catch (err) {
      console.log(`Error converting image to PNG...`)
      console.log(image.jobId)
    }

    callback()
  }

  const jsonDetails = {
    name: '_image_details.json',
    lastModified: new Date(),
    input: JSON.stringify(fileDetails, null, 2)
  }

  const blob = await downloadZip([jsonDetails, ...fileArray]).blob()
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'artbot-image-export.zip'
  link.click()
  link.remove()
}

export const downloadFile = async (image: any) => {
  initBlob()

  const input = await base64toBlob(image.base64String, 'image/webp')

  const filename =
    image.prompt
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase()
      .slice(0, 124) + `.png`

  // @ts-ignore
  const newBlob = await input?.toPNG()

  const { saveAs } = (await import('file-saver')).default
  saveAs(newBlob, filename)
}
